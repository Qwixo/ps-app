// G Squad v3 (PS 1.65, feature "gsquad-v3"): the conversation list (the squad chat, group chats, direct messages).
// The data comes from the other branch (squad/chatview.ts ChatView.convs / activeConv, see ps-dev briefs gsquad-v3-contract);
// until it is merged this file builds the one conversation that exists today from the squad chat, so the list works now.

export type ConvKind = "squad" | "group" | "dm";
export interface Conv { id: string; kind: ConvKind; title: string; memberIds: string[]; last?: { text: string; at: string; from: string }; unread: number; avatar?: string }
export const SQUAD_ID = "squad";

const at = (iso?: string) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : 0; };

/** Newest message first; the ones with nothing yet go last; ties keep the squad on top, then by title. */
export function sortConvs(list: Conv[]): Conv[] {
  return [...list].sort((a, b) => at(b.last?.at) - at(a.last?.at) || (a.kind === "squad" ? -1 : 0) - (b.kind === "squad" ? -1 : 0) || a.title.localeCompare(b.title));
}

/** One checked conversation from anything the view hands over (wrong shapes are dropped). */
export function cleanConv(v: unknown): Conv | null {
  const o = (v && typeof v === "object" ? v : null) as Record<string, unknown> | null;
  if (!o || typeof o.id !== "string" || !o.id || (o.kind !== "squad" && o.kind !== "group" && o.kind !== "dm")) return null;
  const l = (o.last && typeof o.last === "object" ? o.last : null) as Record<string, unknown> | null;
  const s = (x: unknown, n: number) => (typeof x === "string" ? x.slice(0, n) : "");
  return {
    id: o.id.slice(0, 60), kind: o.kind, title: s(o.title, 60) || "Chat",
    memberIds: Array.isArray(o.memberIds) ? o.memberIds.filter((x): x is string => typeof x === "string").slice(0, 200) : [],
    ...(l && typeof l.text === "string" ? { last: { text: s(l.text, 200), at: s(l.at, 40), from: s(l.from, 40) } } : {}),
    unread: Number.isInteger(o.unread) && (o.unread as number) > 0 ? (o.unread as number) : 0,
    ...(typeof o.avatar === "string" && o.avatar ? { avatar: o.avatar.slice(0, 60) } : {}),
  };
}

/** The list to draw: the view's own convs (sorted) when it has them, else just the squad chat from today's single chat. */
export function convsFor(view: { convs?: unknown }, squad: { name: string; memberIds: string[]; unread: number; last?: Conv["last"] }): Conv[] {
  const mine = Array.isArray(view.convs) ? view.convs.map(cleanConv).filter((c): c is Conv => !!c) : [];
  const list = mine.some((c) => c.id === SQUAD_ID) ? mine : [{ id: SQUAD_ID, kind: "squad" as const, title: squad.name, memberIds: squad.memberIds, unread: squad.unread, ...(squad.last ? { last: squad.last } : {}) }, ...mine];
  return sortConvs(list);
}
/** The open one: the view's activeConv if it is in the list, else the squad chat. */
export const activeOf = (list: Conv[], active: unknown): string => (typeof active === "string" && list.some((c) => c.id === active) ? active : SQUAD_ID);
/** "Message" next to a member's name: not for yourself. */
export const canMessage = (memberId: string, meId: string): boolean => !!memberId && memberId !== meId;
/** A line for a row: "You: hi" for yours, the words for the others (a group shows who). */
export function previewLine(c: Conv, meName: string, nameOf: (id: string) => string): string {
  if (!c.last) return "";
  const mine = c.last.from === meName || c.last.from === "You";
  const text = c.last.text.replace(/\s+/g, " ").trim();
  return mine ? `You: ${text}` : c.kind === "dm" ? text : `${nameOf(c.last.from)}: ${text}`;
}
