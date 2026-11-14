// A WhatsApp card's Reply on the Mac (V1.60): the Mac brings the Tab list up and sends "waReply" with the card id. The WhatsApp rows
// (views/WaMail.tsx) may not be on screen yet, so the wish waits here for a few seconds and the rows take it when they show.
// Pure (no DOM, no vault), unit tested. Never sends anything: it only asks for the reply box to open.
const WAIT_MS = 10_000;
let want: { id: string; at: number } | null = null;
const listeners = new Set<() => void>();

/** The card id form: "w:" and a short id. Anything else is ignored. */
export const cleanWaCardId = (v: unknown): string | null => (typeof v === "string" && /^w:[\w-]{1,38}$/.test(v) ? v : null);

export function requestWaReply(id: unknown, now = Date.now()) {
  const c = cleanWaCardId(id);
  if (!c) return;
  want = { id: c, at: now };
  listeners.forEach((l) => l());
}

/** The id waiting to open, once (taken when asked), or null when none waits or it is too old. */
export function takeWaReply(now = Date.now()): string | null {
  const w = want;
  if (!w) return null;
  want = null;
  return now - w.at <= WAIT_MS ? w.id : null;
}

export const peekWaReply = (now = Date.now()) => (want && now - want.at <= WAIT_MS ? want.id : null);
export function onWaReply(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
