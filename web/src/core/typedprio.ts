// Typed priority (V1.40, the developer 7 Nov 2026: "if you type in like P1 when you're adding in a task, it defaults to
// priority one ... highlight the text as well and write suggested P1 ... so you don't actually have to click on
// priority one"). While a task is typed in any add box, a P1, P2 or P3 standing as its own word (any case, anywhere)
// is spotted, painted in that priority's colour and offered as "Suggested: P1". Adding takes it: the word leaves
// the title and the task goes in at that priority. Typed twice, the last one wins. The pure parts live here so
// they can be tested without a page; views/TypedPrio.tsx draws it.

export type PrioNum = 1 | 2 | 3;
/** One typed priority word: which priority, where it sits in the text ([start, end)) and how it was written. */
export type PrioToken = { prio: PrioNum; start: number; end: number; raw: string };

// A P (any case) then 1, 2 or 3, with no letter, digit or underscore touching it on either side. So "MP3",
// "P10", "p1x" and "AP2P" are left alone; "P1,", "(p2)" and "P3." count.
const TOKEN = /(?<![\p{L}\p{N}_])[pP]([123])(?![\p{L}\p{N}_])/gu;

/** Every priority word in the text, first to last. */
export function findPrioTokens(s: string): PrioToken[] {
  const out: PrioToken[] = [];
  for (const m of s.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    out.push({ prio: Number(m[1]) as PrioNum, start, end: start + m[0].length, raw: m[0] });
  }
  return out;
}

/** The text with these words taken out and the spacing tidied: no doubled spaces, no space before a comma or a
 *  full stop, no empty brackets left behind, no stray comma, colon or dash at either end. */
export function stripTokens(s: string, tokens: PrioToken[]): string {
  let t = s;
  for (const k of [...tokens].sort((a, b) => b.start - a.start)) t = t.slice(0, k.start) + " " + t.slice(k.end);
  return t
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])(?=[,;:.!?])/g, "")
    .replace(/^[\s,;:|/-]+/, "")
    .replace(/[\s,;:|/-]+$/, "")
    .trim();
}

/** What the typed text asks for: the winning (last) priority word, all of them (to paint and to take out) and the
 *  title once they are gone. null when there is no priority word. */
export type TypedPrio = { prio: PrioNum; token: PrioToken; tokens: PrioToken[]; title: string };
export function parsePrio(s: string): TypedPrio | null {
  const tokens = findPrioTokens(s);
  if (!tokens.length) return null;
  const token = tokens[tokens.length - 1];
  return { prio: token.prio, token, tokens, title: stripTokens(s, tokens) };
}

/** A name for "this suggestion" that stays the same while the rest of the title is typed around it, and changes
 *  once another priority word is typed. Saying no to a suggestion holds until this changes. */
export const suggestionKey = (p: TypedPrio | null) => (p ? `${p.tokens.length}:${p.prio}` : "");

/**
 * The state of one add box's suggestion, kept outside React so it can be tested. `seen` counts every change, so
 * whichever came last, the typed word or a priority picked by clicking, is the one that is used.
 */
export type PrioState = { key: string; dismissed: string; typedAt: number; pickedAt: number; tick: number };
export const prioStart = (): PrioState => ({ key: "", dismissed: "", typedAt: 0, pickedAt: 0, tick: 0 });

/** The text changed: a new or different priority word counts as typed now. With no priority word left, an earlier
 *  "no" is forgotten (typing it again offers it again). */
export function prioTyped(st: PrioState, text: string): PrioState {
  const key = suggestionKey(parsePrio(text));
  if (key === st.key) return st;
  const tick = st.tick + 1;
  return { ...st, key, tick, typedAt: key ? tick : st.typedAt, dismissed: key ? st.dismissed : "" };
}
/** A priority was picked by clicking (the Priority 1 switch, a place, No priority). */
export const prioPicked = (st: PrioState): PrioState => ({ ...st, tick: st.tick + 1, pickedAt: st.tick + 1 });
/** No thanks: the x on the chip, or Backspace right after the word. The text stays as it was written. */
export const prioDismiss = (st: PrioState): PrioState => ({ ...st, dismissed: st.key });

/** The suggestion to show now, or null (none typed, or said no to). */
export function prioOffer(st: PrioState, text: string): TypedPrio | null {
  const p = parsePrio(text);
  if (!p || suggestionKey(p) === st.dismissed) return null;
  return p;
}

/** What Add should use: the typed priority and the cleaned title when the typed word is on offer and came after any
 *  clicked pick; otherwise null (the title as written and the priority from the controls). */
export function prioOnAdd(st: PrioState, text: string): TypedPrio | null {
  const p = prioOffer(st, text);
  if (!p || st.pickedAt > st.typedAt) return null;
  return p;
}

/** Backspace with the caret right after the winning word (nothing selected) means no thanks rather than deleting. */
export function backspaceDismisses(st: PrioState, text: string, caret: number | null, selEnd: number | null): boolean {
  const p = prioOnAdd(st, text);
  return !!p && caret != null && caret === selEnd && caret === p.token.end;
}

/**
 * Where a task with a typed priority goes in the list. P1 joins the Priority 1 group. P2 and P3 are places in the
 * numbered list under it (P2 is the first task after the group, core/prio.ts prioNumbers): the new task is put
 * there, or at the end when the list is shorter. `index` is the place among the numbered tasks that are not P1.
 */
export function typedPlace(prio: PrioNum, numberedNotP1: number): { p1: boolean; index: number } {
  if (prio === 1) return { p1: true, index: 0 };
  return { p1: false, index: Math.min(prio - 2, numberedNotP1) };
}

/** The order number (and P1 flag) for a task added with a typed priority. `ranked`: the one-off tasks as the Tab list
 *  shows them (core/prio.ts sortPrio: the P1 group, then the numbered tasks, then the ones with no priority). P1 goes
 *  at the end of the P1 group; P2 and P3 take that place in the numbered list (typedPlace). */
export function typedOrder(ranked: { order?: number; p1?: boolean; unranked?: boolean }[], prio: PrioNum): { p1: boolean; order: number } {
  const between = (list: { order?: number }[], k: number) => {
    const before = list[k - 1]?.order, after = list[k]?.order;
    if (before != null && after != null) return (before + after) / 2;
    if (after != null) return after - 1;
    if (before != null) return before + 1;
    return 0;
  };
  const group = ranked.filter((t) => t.p1 === true);
  if (prio === 1) return { p1: true, order: between(group, group.length) };
  const numbered = ranked.filter((t) => t.p1 !== true && !t.unranked);
  const { index } = typedPlace(prio, numbered.length);
  // No numbered tasks yet: just after the P1 group (or 0 on an empty list).
  if (!numbered.length) return { p1: false, order: between(group, group.length) };
  return { p1: false, order: between(numbered, index) };
}
