// Feature requests from the Settings assistant (PS 1.65). When no setting does what the person asked, the assistant says so, offers the
// closest thing and sends a feature request to a new "Feature requests" area of the G Squad, where the developers' AIs can read it.
// What is in a request, and NOTHING else: the person's own words, and which part of Settings they were in (a group's name from
// core/settingsindex.ts). No name, no email, no setting value, nothing from the vault, no list of what is switched on. It is sealed with
// the squad key before it leaves (squad/featreqhub.ts), it changes only when the person asks (nothing polls), and Undo takes it back for a
// few seconds (UNDO_MS: the request is held on this device that long before it is sent, and a sent one can still be deleted).
// Pure (no vault, no network, no clock of its own): tests/featreq.test.ts checks every rule.
import { GROUPS, type GroupId } from "./settingsindex.ts";

export const FR_VERSION = 1;
export const FR_MAX = 500;
/** How long Undo works before the request leaves this device. */
export const UNDO_MS = 6000;
/** Added to the squad crypto's version string by the sealer, so a request can never be opened as anything else. */
export const frAad = (v: string, squad: string, member: string, id: string) => `${v}:featreq:${squad}:${member}:${id}`;

export interface FeatureRequest { v: 1; id: string; text: string; part: string | null; at: string }
const GROUP_IDS = new Set<string>(GROUPS.map((g) => g.id));

/** Takes out what must never leave: an email address, a link with a secret, a long key-like string. */
export function scrub(t: string): string {
  return t
    .replace(/[–—]/g, ", ")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/g, "[removed]")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/\b[A-Za-z0-9_\-+/=]{28,}\b/g, "[removed]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, FR_MAX);
}
/** The request: only words and the part of Settings (a group id from the list, else none). Null when there are no words. */
export function buildRequest(text: unknown, part: unknown, now: Date, id: string): FeatureRequest | null {
  if (typeof text !== "string") return null;
  const t = scrub(text);
  if (t.length < 3) return null;
  const p = typeof part === "string" && GROUP_IDS.has(part) ? part : null;
  return { v: 1, id, text: t, part: p, at: now.toISOString() };
}
/** What a developer's AI reads after it opens one: exactly these four keys. */
export const requestKeys = (r: FeatureRequest): string[] => Object.keys(r).sort();
export function cleanRequest(v: unknown): FeatureRequest | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.v !== 1 || typeof o.id !== "string" || !/^[0-9a-f-]{36}$/i.test(o.id) || typeof o.at !== "string") return null;
  const r = buildRequest(o.text, o.part, new Date(o.at), o.id);
  return r ? { ...r, at: o.at } : null;
}

// ---------- the person's own list on this device, and Undo ----------
export type FrState = "held" | "sent" | "waiting" | "undone" | "kept";
export interface FrEntry { req: FeatureRequest; state: FrState; sendAt: number }
/** A new request is held for UNDO_MS. */
export const hold = (req: FeatureRequest, now: number): FrEntry => ({ req, state: "held", sendAt: now + UNDO_MS });
/** Undo works on a held request (it never leaves) and on a sent one (the hub is asked to delete it). */
export const canUndo = (e: FrEntry): boolean => e.state === "held" || e.state === "sent";
export const undo = (e: FrEntry): FrEntry => (canUndo(e) ? { ...e, state: "undone" } : e);
export const due = (e: FrEntry, now: number): boolean => e.state === "held" && now >= e.sendAt;
/** After the send tried: sent, or waiting (the squad server has no Feature requests part yet) or kept (no squad). */
export function afterSend(e: FrEntry, result: "sent" | "missing" | "nosquad"): FrEntry {
  if (e.state !== "held") return e;
  return { ...e, state: result === "sent" ? "sent" : result === "missing" ? "waiting" : "kept" };
}
/** A request that could not go out yet (the hub had no Feature requests part, or there was no squad): it goes with the next send. */
export const retryable = (e: FrEntry): boolean => e.state === "waiting" || e.state === "kept";
export function cleanEntries(v: unknown): FrEntry[] {
  if (!Array.isArray(v)) return [];
  const out: FrEntry[] = [];
  for (const x of v.slice(0, 50)) {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const req = cleanRequest(o.req);
    const st = o.state;
    if (!req || (st !== "held" && st !== "sent" && st !== "waiting" && st !== "undone" && st !== "kept")) continue;
    out.push({ req, state: st === "held" ? "kept" : st, sendAt: typeof o.sendAt === "number" ? o.sendAt : 0 });   // a held one from before a restart is not sent by itself
  }
  return out;
}
export type { GroupId };

// ---------- the squad's list (Settings, G Squad, Feature requests: what a developer's AI reads) ----------
/** One request of the squad, opened on this device. `mine` only marks your own; no name or member id is kept. */
export interface SquadRow { id: string; text: string; part: string | null; at: string; mine: boolean }
export const SQUAD_LIST_MAX = 200;
/** Change only: new rows are added, changed ones replaced, taken back ones removed. Newest first, capped. */
export function mergeSquadList(list: SquadRow[], changes: { id: string; gone: boolean; req?: FeatureRequest; mine: boolean }[]): SquadRow[] {
  const by = new Map(list.map((r) => [r.id, r]));
  for (const c of changes) {
    if (c.gone || !c.req) { by.delete(c.id); continue; }
    by.set(c.id, { id: c.id, text: c.req.text, part: c.req.part, at: c.req.at, mine: c.mine });
  }
  return [...by.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, SQUAD_LIST_MAX);
}
/** The list as plain text for a developer's AI: one line per request, the part of Settings and the words. Nothing else. */
export function squadListText(list: SquadRow[], label: (part: string) => string): string {
  return list.map((r) => `${r.at.slice(0, 10)} | ${r.part ? label(r.part) : "Settings"} | ${r.text.replace(/\s+/g, " ")}`).join("\n");
}
