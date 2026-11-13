// G Squad (V1.40): what the Tab list is told about the squad, and what it may ask for. The Tab list holds no keys
// (like the rest of the overlay): the main page opens everything and sends this plain view in the state it already
// sends; the Tab list's buttons come back as one `squadOp`, checked here, run by squad/engine.ts.
import { isPiece, type SharePiece } from "../core/squadshare.ts";
import { cleanName } from "../core/squadrec.ts";
import type { TaskCopy } from "../core/squadshare.ts";
import type { BoardView } from "../core/squadboard.ts";
import type { AutoStage } from "../core/squadauto.ts";

export interface SquadMember { id: string; name: string; me: boolean; creator: boolean; working: boolean }
export interface SquadTask extends TaskCopy { id: string; member: string }
export interface SquadHand { id: string; from: string; to: string; state: "open" | "accepted" | "declined" | "cancelled"; t: string; d: string | null; at: string }
export interface SquadView {
  in: boolean;                   // you are in a squad
  name: string;
  me: string;                    // your member id
  meName: string;
  creator: boolean;              // you may take members out
  count: number | null;          // working right now (null = not known yet)
  waiting: number;               // hand overs waiting for your answer
  members: SquadMember[];
  tasks: SquadTask[];
  hands: SquadHand[];
  link: { url: string; expiresAt: string } | null;   // the invite you just made (shown once, you send it yourself)
  busy: string | null;           // "Joining", "Making a link", ...
  error: string | null;
  loaded: boolean;               // the pop-up's data has come in at least once since it opened
  board?: BoardView | null;      // Leaderboard and Screen time (squad/board.ts), already worked out
  dir?: DirView | null;          // V1.42: See available squads and your request (squad/direngine.ts)
  asks?: SquadAsk[];             // V1.42: requests to join waiting for you, the admin
  /** V1.49 one squad, everyone in: where your automatic join stands while you are not in (squad/autoengine.ts). */
  auto?: { stage: AutoStage; error?: string | null; /** V1.57 asked: the check code the admin sees too */ code?: string | null } | null;
  friend?: FriendView | null;    // V1.44 Add friend: the QR code's link (made fresh each time the page opens)
}
/** Where the automatic join stands, as the Tab list may take it from PS (squad/mirror.ts). V1.57: "asked" with its
 *  check code (the code only for that stage). */
const AUTO_STAGES = new Set(["joining", "asked", "left", "removed", "full", "error"]);
export function cleanAutoView(v: unknown): SquadView["auto"] {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || typeof o.stage !== "string" || !AUTO_STAGES.has(o.stage)) return null;
  return { stage: o.stage as AutoStage, error: typeof o.error === "string" ? o.error.slice(0, 200) : null,
    ...(o.stage === "asked" && typeof o.code === "string" ? { code: o.code.slice(0, 8) } : {}) };
}
/** V1.44 Add friend, as the Tab list sees it (squad/addfriend.ts makes it). */
export type FriendView =
  | { kind: "join"; url: string; expiresAt: string }
  | { kind: "ask"; url: string; expiresAt: string }
  | { kind: "none"; why: "private" | "no-squad" }
  | { kind: "busy" }
  | { kind: "error"; message: string };
/** V1.42 squad directory, as the Tab list sees it. */
export interface DirView {
  list: { id: string; name: string }[] | null;   // null: not looked yet or loading
  canCreate: boolean;            // The developer's PS only, and only while nothing is listed: Create The G Squad
  ask: { squadId: string; name: string; me: string; state: "open" | "declined" | "cancelled"; code: string; at: string; againAt: string | null } | null;
  busy: string | null;
  error: string | null;
}
/** What the Available squads box shows (V1.44): a real error is never shown as an empty list. */
export type DirState = "loading" | "error" | "empty" | "list";
export function dirState(d: Pick<DirView, "list" | "busy" | "error"> | null | undefined): DirState {
  if (!d || d.busy === "Looking") return "loading";
  if (d.list) return d.list.length ? "list" : "empty";
  return d.error ? "error" : "loading";
}
export interface SquadAsk { id: string; name: string; code: string; at: string; ok: boolean }
export const EMPTY_VIEW: SquadView = { in: false, name: "", me: "", meName: "", creator: false, count: null, waiting: 0, members: [], tasks: [], hands: [], link: null, busy: null, error: null, loaded: false };

export type SquadOp =
  | { op: "open"; on: boolean } | { op: "peek" } | { op: "refresh" }
  | { op: "create"; name: string; me: string } | { op: "join"; link: string; me: string }
  | { op: "invite" } | { op: "clearLink" } | { op: "leave" } | { op: "remove"; member: string }
  | { op: "share"; piece: SharePiece; on: boolean }
  | { op: "task"; id: string; sqOff?: boolean; sqOn?: boolean; sqAnon?: boolean | null }
  | { op: "hand"; id: string; to: string } | { op: "answer"; id: string; accept: boolean } | { op: "cancel"; id: string }
  // V1.42 squad directory
  | { op: "dir" } | { op: "ask"; squad: string; me: string } | { op: "askCancel" } | { op: "askClear" }
  | { op: "approve"; id: string } | { op: "decline"; id: string }
  // V1.49: Join again after leaving, or Try again after a problem joining
  | { op: "rejoin" }
  // V1.43 names
  | { op: "renameSquad"; name: string } | { op: "renameMe"; name: string }
  // V1.44 Add friend: a fresh code, and done with it
  | { op: "friend" } | { op: "friendClose" };
export const DIR_OPS = new Set(["dir", "ask", "askCancel", "askClear", "approve", "decline"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const okId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
/** One request from the Tab list, checked field by field (anything else is dropped). */
export function cleanSquadOp(v: unknown): SquadOp | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  switch (o.op) {
    case "open": return { op: "open", on: o.on === true };
    case "peek": case "refresh": case "invite": case "clearLink": case "leave": case "friend": case "friendClose": case "rejoin": return { op: o.op };
    case "create": return { op: "create", name: text(o.name, 40), me: text(o.me, 40) };
    case "join": { const link = text(o.link, 600); return link ? { op: "join", link, me: text(o.me, 40) } : null; }
    case "remove": return typeof o.member === "string" && UUID.test(o.member) ? { op: "remove", member: o.member.toLowerCase() } : null;
    case "share": return isPiece(o.piece) && typeof o.on === "boolean" ? { op: "share", piece: o.piece, on: o.on } : null;
    case "task": {
      if (!okId(o.id)) return null;
      const r: SquadOp = { op: "task", id: o.id };
      if (typeof o.sqOff === "boolean") r.sqOff = o.sqOff;
      if (typeof o.sqOn === "boolean") r.sqOn = o.sqOn;
      if (typeof o.sqAnon === "boolean" || o.sqAnon === null) r.sqAnon = o.sqAnon as boolean | null;
      return "sqOff" in r || "sqOn" in r || "sqAnon" in r ? r : null;
    }
    case "hand": return okId(o.id) && typeof o.to === "string" && UUID.test(o.to) ? { op: "hand", id: o.id, to: o.to.toLowerCase() } : null;
    case "answer": return typeof o.id === "string" && UUID.test(o.id) && typeof o.accept === "boolean" ? { op: "answer", id: o.id.toLowerCase(), accept: o.accept } : null;
    case "cancel": return typeof o.id === "string" && UUID.test(o.id) ? { op: "cancel", id: o.id.toLowerCase() } : null;
    case "dir": case "askCancel": case "askClear": return { op: o.op };
    case "ask": return typeof o.squad === "string" && UUID.test(o.squad) && text(o.me, 40) ? { op: "ask", squad: o.squad.toLowerCase(), me: text(o.me, 40) } : null;
    case "approve": case "decline": return typeof o.id === "string" && UUID.test(o.id) ? { op: o.op, id: o.id.toLowerCase() } : null;
    case "renameSquad": case "renameMe": { const name = cleanName(o.name); return name ? { op: o.op, name } : null; }
  }
  return null;
}

/** The hover line on the button. "Working", never "online" (the developer). */
export function workingLine(n: number | null): string {
  if (n === null) return "G Squad";
  if (n === 0) return "Nobody is working right now";
  return n === 1 ? "1 person is working right now" : `${n} people are working right now`;
}
