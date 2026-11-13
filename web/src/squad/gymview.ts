// G Squad Fitness (V1.40): the plain view the Fitness screens draw from (no keys, already opened), the ops they send
// back, and the one way a screen reaches either: on PS's Tab list (which holds no keys) through the main page, on the
// phone app's page and PS's main page straight to the engine (squad/gym.ts). The website never talks to the hub.
import { useSyncExternalStore } from "react";
import { cleanEx, cleanPost, cleanSleepCard, cleanSum, CH_LENGTHS, REACTIONS, COMMENT_MAX, type ChMetric, type GymEx, type GymPost, type GymSleep, type GymSum } from "../core/gymsquad.ts";

export interface GymMember { id: string; name: string; me: boolean; working: boolean }
export interface GymCard { id: string; sum: GymSum | null; sleep: GymSleep | null }
export interface GymPostV { id: string; by: string; at: string; post: GymPost }
export interface GymExView { key: string; rows: { member: string; ex: GymEx }[]; loading: boolean }
export interface GymSquadView {
  on: boolean;                               // this page can reach G Squad (PS on the Mac or the phone, signed in)
  in: boolean;                               // you are in a squad
  me: string;
  share: { fitness: boolean; sleep: boolean };
  members: GymMember[];
  cards: GymCard[];
  posts: GymPostV[];
  ex: GymExView | null;                      // the compare screen's exercise, for everyone
  loaded: boolean;
  error: string | null;
}
export const GYM_EMPTY: GymSquadView = { on: false, in: false, me: "", share: { fitness: true, sleep: true }, members: [], cards: [], posts: [], ex: null, loaded: false, error: null };

export type GymOp =
  | { op: "open"; on: boolean; ex?: string | null }
  | { op: "refresh" }
  | { op: "react"; to: string; pb: string; e: string | null }
  | { op: "comment"; to: string; pb: string; t: string }
  | { op: "unpost"; id: string }
  | { op: "challenge"; metric: ChMetric; days: number; from: string; t?: string }
  | { op: "join"; ch: string; on: boolean }
  | { op: "share"; piece: "fitness" | "sleep"; on: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PB = /^[A-Za-z0-9:_-]{1,48}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
/** One request from a screen, checked field by field (anything else is dropped). */
export function cleanGymOp(v: unknown): GymOp | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  switch (o.op) {
    case "open": return { op: "open", on: o.on === true, ex: typeof o.ex === "string" && o.ex.length <= 160 ? o.ex : null };
    case "refresh": return { op: "refresh" };
    case "react": return typeof o.to === "string" && UUID.test(o.to) && typeof o.pb === "string" && PB.test(o.pb) && (o.e === null || (REACTIONS as readonly string[]).includes(o.e as string))
      ? { op: "react", to: o.to.toLowerCase(), pb: o.pb, e: o.e as string | null } : null;
    case "comment": { const t = text(o.t, COMMENT_MAX); return t && typeof o.to === "string" && UUID.test(o.to) && typeof o.pb === "string" && PB.test(o.pb) ? { op: "comment", to: o.to.toLowerCase(), pb: o.pb, t } : null; }
    case "unpost": return typeof o.id === "string" && UUID.test(o.id) ? { op: "unpost", id: o.id.toLowerCase() } : null;
    case "challenge": {
      if ((o.metric !== "days" && o.metric !== "volume" && o.metric !== "km") || !(CH_LENGTHS as readonly number[]).includes(o.days as number) || typeof o.from !== "string" || !DAY.test(o.from)) return null;
      const t = text(o.t, 60);
      return { op: "challenge", metric: o.metric, days: o.days as number, from: o.from, ...(t ? { t } : {}) };
    }
    case "join": return typeof o.ch === "string" && UUID.test(o.ch) && typeof o.on === "boolean" ? { op: "join", ch: o.ch.toLowerCase(), on: o.on } : null;
    case "share": return (o.piece === "fitness" || o.piece === "sleep") && typeof o.on === "boolean" ? { op: "share", piece: o.piece, on: o.on } : null;
  }
  return null;
}

// ---------- the Tab list's copy (from the main page's state) ----------
let mirror: GymSquadView = GYM_EMPTY;
const subs = new Set<() => void>();
const arr = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max).filter((x) => x && typeof x === "object") as Record<string, unknown>[] : []);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
/** From the state PS hands the Tab list (null while locked). Checked again, like anything that crosses pages. */
export function setGymMirror(v: unknown) {
  const o = (v && typeof v === "object" ? v : null) as Record<string, unknown> | null;
  const next: GymSquadView = !o ? GYM_EMPTY : {
    on: o.on === true, in: o.in === true, me: str(o.me, 40),
    share: { fitness: (o.share as { fitness?: unknown } | undefined)?.fitness !== false, sleep: (o.share as { sleep?: unknown } | undefined)?.sleep !== false },
    members: arr(o.members, 40).map((m) => ({ id: str(m.id, 40), name: str(m.name, 40) || "Someone", me: m.me === true, working: m.working === true })),
    cards: arr(o.cards, 40).map((c) => ({ id: str(c.id, 40), sum: cleanSum(c.sum), sleep: cleanSleepCard(c.sleep) })),
    posts: arr(o.posts, 600).map((p) => ({ id: str(p.id, 40), by: str(p.by, 40), at: str(p.at, 40), post: cleanPost(p.post) })).filter((p): p is GymPostV => !!p.post),
    ex: o.ex && typeof o.ex === "object" ? (() => { const e = o.ex as Record<string, unknown>; return { key: str(e.key, 160), loading: e.loading === true,
      rows: arr(e.rows, 60).map((r) => ({ member: str(r.member, 40), ex: cleanEx(r.ex) })).filter((r): r is { member: string; ex: GymEx } => !!r.ex) }; })() : null,
    loaded: o.loaded === true, error: typeof o.error === "string" ? o.error.slice(0, 200) : null,
  };
  if (JSON.stringify(next) === JSON.stringify(mirror)) return;
  mirror = next;
  subs.forEach((l) => l());
}
export const gymMirror = {
  subscribe(l: () => void) { subs.add(l); return () => { subs.delete(l); }; },
  get: () => mirror,
};
export function useStoreView(store: { subscribe(l: () => void): () => void; get(): GymSquadView }): GymSquadView {
  return useSyncExternalStore(store.subscribe, store.get);
}
