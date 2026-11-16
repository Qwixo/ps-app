// G Squad v3 (PS 1.65): what the Tab list is told about conversations and members (plain, no keys), the ops it may ask
// for, and the rules that build the list. The shape is the contract with the look (briefs: gsquad-v3-contract).
import { cleanTitle, cleanAvatar, isUuid } from "../core/squaddm.ts";

export type ConvKind = "squad" | "group" | "dm";
export interface ConvView {
  id: string; kind: ConvKind; title: string; memberIds: string[];
  last?: { text: string; at: string; from: string }; unread: number;
  avatar?: string;   // a member id (a DM: the other person) whose picture to show; absent = letters
}
/** A squad member as the screen needs them. pic = a small data URL (absent = a letter). */
export interface MemberView { id: string; name: string; me: boolean; left: boolean; pic?: string }
export const SQUAD_CONV = "squad";

export type DmOp =
  | { op: "openConv"; id: string }
  | { op: "newDm"; memberId: string }
  | { op: "newGroup"; title: string; memberIds: string[] }
  | { op: "setAvatar"; dataUrl: string } | { op: "clearAvatar" }
  | { op: "groupAdd"; id: string; memberIds: string[] } | { op: "groupRemove"; id: string; memberId: string } | { op: "leaveConv"; id: string };

const uid = (v: unknown) => (isUuid(v) ? v.toLowerCase() : null);
/** One DM or group request from the Tab list, checked field by field (anything else is dropped). */
export function cleanDmOp(v: unknown): DmOp | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const ids = (x: unknown) => (Array.isArray(x) ? [...new Set(x.slice(0, 40).map(uid).filter((i): i is string => !!i))] : []);
  switch (o.op) {
    case "openConv": return o.id === SQUAD_CONV ? { op: "openConv", id: SQUAD_CONV } : uid(o.id) ? { op: "openConv", id: uid(o.id)! } : null;
    case "newDm": return uid(o.memberId) ? { op: "newDm", memberId: uid(o.memberId)! } : null;
    case "newGroup": { const t = cleanTitle(o.title), m = ids(o.memberIds); return t && m.length >= 2 && m.length <= 23 ? { op: "newGroup", title: t, memberIds: m } : null; }
    case "setAvatar": { const d = cleanAvatar(o.dataUrl); return d ? { op: "setAvatar", dataUrl: d } : null; }
    case "clearAvatar": return { op: "clearAvatar" };
    case "groupAdd": { const i = uid(o.id), m = ids(o.memberIds); return i && m.length ? { op: "groupAdd", id: i, memberIds: m } : null; }
    case "groupRemove": { const i = uid(o.id), m = uid(o.memberId); return i && m ? { op: "groupRemove", id: i, memberId: m } : null; }
    case "leaveConv": { const i = uid(o.id); return i ? { op: "leaveConv", id: i } : null; }
  }
  return null;
}

const cut = (x: unknown, n: number) => (typeof x === "string" ? x.slice(0, n) : "");
export function cleanConvs(v: unknown): ConvView[] {
  if (!Array.isArray(v)) return [];
  const out: ConvView[] = [];
  for (const c of v.slice(0, 120)) {
    const o = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
    const kind = o.kind === "squad" || o.kind === "group" || o.kind === "dm" ? o.kind : null;
    if (!kind || typeof o.id !== "string") continue;
    const l = o.last as Record<string, unknown> | undefined;
    out.push({
      id: cut(o.id, 40), kind, title: cut(o.title, 60) || "Chat", memberIds: (Array.isArray(o.memberIds) ? o.memberIds : []).slice(0, 40).map((m) => cut(m, 40)).filter(Boolean),
      ...(l && typeof l === "object" && typeof l.at === "string" ? { last: { text: cut(l.text, 140), at: cut(l.at, 40), from: cut(l.from, 40) } } : {}),
      unread: Number.isInteger(o.unread) && (o.unread as number) > 0 ? Math.min(o.unread as number, 9999) : 0,
      ...(typeof o.avatar === "string" && o.avatar ? { avatar: cut(o.avatar, 40) } : {}),
    });
  }
  return out;
}
export function cleanMembers(v: unknown): MemberView[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 60).filter((m) => m && typeof m === "object" && typeof m.id === "string").map((m): MemberView => {
    const pic = cleanAvatar(m.pic);
    return { id: cut(m.id, 40), name: cut(m.name, 40) || "Someone", me: m.me === true, left: m.left === true, ...(pic ? { pic } : {}) };
  });
}

export interface ConvInput {
  id: string; kind: ConvKind; title: string; memberIds: string[]; unread: number;
  last?: { text: string; at: string; from: string }; avatar?: string;
}
const ms = (iso: string) => { const t = Date.parse(iso); return Number.isNaN(t) ? 0 : t; };
/** The list: "squad" is always there; the rest only when the hub has DMs. Newest last message first, none last. */
export function buildConvs(items: ConvInput[]): ConvView[] {
  const list = items.map((c): ConvView => ({
    id: c.id, kind: c.kind, title: c.title, memberIds: c.memberIds, unread: Math.max(0, c.unread),
    ...(c.last ? { last: { text: c.last.text.slice(0, 140), at: c.last.at, from: c.last.from } } : {}), ...(c.avatar ? { avatar: c.avatar } : {}),
  }));
  if (!list.some((c) => c.id === SQUAD_CONV)) list.unshift({ id: SQUAD_CONV, kind: "squad", title: "G Squad", memberIds: [], unread: 0 });
  return list.sort((a, b) => ms(b.last?.at ?? "") - ms(a.last?.at ?? "") || (a.id === SQUAD_CONV ? -1 : b.id === SQUAD_CONV ? 1 : a.title.localeCompare(b.title)));
}

/** Where a queued message goes: the squad chat only if it was written there; a private one whose conversation is gone is
 *  "gone" (dropped with a note), never rerouted to the squad chat. */
export function sendRoute(conv: string, convStillHere: boolean): "squad" | "dm" | "gone" {
  return conv === SQUAD_CONV ? "squad" : convStillHere ? "dm" : "gone";
}
