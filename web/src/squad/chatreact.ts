// G Squad reactions and emoji only messages (PS 1.63, feature "gsquad-signal"). Rules only, no screen, no network.
// A reaction is a sealed chat row whose body names the message it is on and one emoji (core/squadchat.ts ChatReact).
// Taking one back deletes that row (the hub keeps no words). Everyone sees the same thing because the rows are all there is:
// one reaction per person per emoji per message, counted, in the order they first came.
export const QUICK_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export interface ReactEvent { id: string; from: string; to: string; e: string; at: string }
export interface ReactionPill { e: string; n: number; mine: boolean; who: string[] }

/** The pills under each message: Map from message id to its pills. A reaction on a message that is not in `known` (deleted,
 *  older than what is loaded, never existed) is ignored. A second copy of the same person's same emoji counts once. */
export function foldReactions(events: ReactEvent[], known: (id: string) => boolean, me: string, nameOf: (id: string) => string = () => "Someone"): Map<string, ReactionPill[]> {
  const sorted = [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id.localeCompare(b.id)));
  const seen = new Set<string>();
  const out = new Map<string, ReactionPill[]>();
  for (const ev of sorted) {
    if (!known(ev.to)) continue;
    const key = `${ev.from}|${ev.to}|${ev.e}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = out.get(ev.to) ?? [];
    let p = list.find((x) => x.e === ev.e);
    if (!p) { p = { e: ev.e, n: 0, mine: false, who: [] }; list.push(p); }
    p.n++;
    if (ev.from === me) { p.mine = true; p.who.unshift("You"); } else p.who.push(nameOf(ev.from));
    out.set(ev.to, list);
  }
  return out;
}

/** What tapping an emoji on a message does: take yours back (the row ids to delete), or add it. */
export function reactPlan(events: ReactEvent[], me: string, to: string, e: string): { remove: string[] } | { add: true } {
  const mine = events.filter((x) => x.from === me && x.to === to && x.e === e).map((x) => x.id);
  return mine.length ? { remove: mine } : { add: true };
}

/** "Sam, Alex and You" for a pill's tooltip. */
export function whoLine(who: string[]): string {
  if (who.length <= 1) return who[0] ?? "";
  return `${who.slice(0, -1).join(", ")} and ${who[who.length - 1]}`;
}

/** How many emoji a text is made of when it is emoji and spaces only (at most `max`), else 0. A lone "1" or "#" is not one. */
export function emojiOnly(text: string, max = 6): number {
  const t = text.trim();
  if (!t || t.length > 80) return 0;
  const one = /^(?:\p{Regional_Indicator}{2}|[0-9#*]️?⃣|(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:[\p{Emoji_Modifier}️\u{E0020}-\u{E007F}]|‍(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}))*)$/u;
  const parts: string[] = [];
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: object) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) for (const s of new Seg(undefined, { granularity: "grapheme" }).segment(t)) parts.push(s.segment);
  else parts.push(...(t.match(/\p{Regional_Indicator}{2}|[0-9#*]️?⃣|\p{Extended_Pictographic}[\p{Emoji_Modifier}️]?(?:‍\p{Extended_Pictographic}[\p{Emoji_Modifier}️]?)*|\s+|./gu) ?? []));
  let n = 0;
  for (const p of parts) {
    if (/^\s+$/.test(p)) continue;
    if (!one.test(p)) return 0;
    if (++n > max) return 0;
  }
  return n;
}
/** Signal like sizes: one emoji is big, a few are smaller. */
export const emojiSize = (n: number): "xl" | "l" | "m" | "" => (n === 1 ? "xl" : n <= 3 && n > 0 ? "l" : n > 0 ? "m" : "");

export interface Box { left: number; top: number; width: number; height: number }
/** Where a pop up of `size` goes inside `box` (the chat panel) next to `anchor`: above it when there is room, else below, kept
 *  inside the box with an `edge` gap. Everything is in the same coordinates; the result is relative to the box. */
export function placeIn(box: Box, anchor: Box, size: { width: number; height: number }, edge = 8): { left: number; top: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const w = Math.min(size.width, box.width - 2 * edge), h = Math.min(size.height, box.height - 2 * edge);
  const above = anchor.top - box.top - h - 6;
  const below = anchor.top + anchor.height - box.top + 6;
  const top = above >= edge ? above : below + h <= box.height - edge ? below : clamp(above, edge, box.height - h - edge);
  const left = clamp(anchor.left - box.left + anchor.width / 2 - w / 2, edge, box.width - w - edge);
  return { left: Math.round(left), top: Math.round(top) };
}

/** The text with `ins` put where the cursor (or selection) is, cut to `max` characters. Returns the text and where the cursor goes. */
export function insertAt(text: string, start: number, end: number, ins: string, max: number): { text: string; at: number } {
  const a = Math.max(0, Math.min(start, text.length)), b = Math.max(a, Math.min(end, text.length));
  const next = text.slice(0, a) + ins + text.slice(b);
  if (next.length > max) return { text, at: a };
  return { text: next, at: a + ins.length };
}
