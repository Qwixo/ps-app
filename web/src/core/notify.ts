import { CAMPAIGNS_ON } from "./features.ts";
// Notification pop-ups: one line saying what just changed in the vault from outside (Claude's
// packages, the calendar refresh). The app decides where they show (a toast on the web, a small
// pop-up at the top right of the screen in PS) and whether the developer has them switched on.
/** A richer card for PS's pop-ups: headline, a line under it, a short preview, a Gmail link. */
export interface NoteCard { title: string; sub?: string; body?: string; url?: string }
let sink: ((text: string, card?: NoteCard) => void) | null = null;
export function setNotifySink(fn: ((text: string, card?: NoteCard) => void) | null) { sink = fn; }
/** `text` is the one line kept in the history (and shown on the website); `card` is PS's pop-up. */
export function notify(text: string, card?: NoteCard) { try { sink?.(text, card); } catch { /* a pop-up must never break a sync */ } }

type OpLike = { op: string; name?: string };
/** Steps that change nothing the developer reads in the vault: a finished chat (it has its own card, core/chatdone.ts)
 *  trimming old Instantly preview copies, and the developer's private release notes (the What's new panel is their notice,
 *  core/privatenotes.ts). They never count toward "Claude updated your vault". */
const QUIET_OPS = new Set(["chatDone", "pruneInstantly", "psPrivateNotes", "rewindMoney"]);   // rewindMoney: Rewind is never announced (src/rewind.ts)
export const quietOp = (op: string) => QUIET_OPS.has(op);
/** "Claude updated your vault: Sample Vintage's dashboard, your Morning Brief, 2 to-do items". */
export function describeOps(ops: OpLike[]) {
  const names = new Set<string>();
  let briefs = 0, todos = 0, other = 0, stats = 0, fit = 0;
  for (const o of ops) {
    if (quietOp(o.op)) continue;
    if (o.op === "putBrief") briefs++;
    else if (o.op === "putCampaignStats" || o.op === "putCampaignsPage") stats++;
    else if (o.op === "fitPlans") fit++;
    else if (o.op === "addTodo" || o.op === "claudeTick" || o.op === "addSubtask" || o.op === "claudeTickSubtask") todos++;
    else if (o.name && o.op !== "updateSettings") names.add(o.name);
    else other++;
  }
  const parts = [...names].map((n) => `${n}${/s$/i.test(n) ? "'" : "'s"} dashboard`);
  if (briefs) parts.push("your Morning Brief");
  if (stats && CAMPAIGNS_ON) parts.push("Cincee Campaigns");   // off (core/features.ts): the panel is gone, so no notice for its data
  if (fit) parts.push("your Fitness plans");
  if (todos) parts.push(`${todos} to-do item${todos === 1 ? "" : "s"}`);
  if (!parts.length && other) parts.push(`${other} setting${other === 1 ? "" : "s"}`);
  return parts;
}
