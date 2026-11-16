// G Squad members list (PS 1.64), the developer 16 Nov 2026: who is in, with a picture, a name and a status. The developer's words:
// online means "at their computer in the last 15 minutes, OR in the Fitness tab (at the gym)". So a member shows
//   "At the gym"          their Fitness screen is open or a workout is running (told within the last 15 minutes)
//   "Online"              their PS beat within the last 15 minutes (the beat only runs while PS runs and the computer
//                         is awake, every 3 minutes)
//   "Last seen 2 h ago"   the time of their last beat, back 14 days
//   nothing               they switched off sharing "working" (no beat at all, and PS 1.64 clears the last one), or
//                         nothing is known. Never a guess.
// The hub sees the beat's time (it always has: that is "working"), never the gym: "at the gym" travels sealed with the
// squad key inside the beat (gymAad), like every other thing a member shares. This file is pure (no hub, no screen).
import * as S from "./squadcrypto.ts";
import { currentKey, keyFor, type SquadRec } from "./squadrec.ts";

export const ONLINE_MS = 15 * 60_000;
export const GYM_MS = 15 * 60_000;
export const SEEN_DAYS = 14;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the beat carries, sealed: when this person was last seen at the gym (Fitness open or a workout running). */
export interface PresenceBody { g: string | null }
export const presenceAad = (squad: string, member: string, gen: number) => `${S.V}:presence:${squad}:${member}:${gen}`;

const iso = (v: unknown): string | null => (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);
export function cleanPresence(v: unknown): PresenceBody | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  return { g: iso(o.g) };
}
/** Your gym time, sealed under the squad's newest key for the beat. */
export async function sealPresence(rec: SquadRec, gymAt: string): Promise<{ st: string; sg: number }> {
  const k = currentKey(rec);
  return { st: await S.seal(k.raw, { g: gymAt } satisfies PresenceBody, presenceAad(rec.squadId, rec.memberId, k.gen)), sg: k.gen };
}
/** Someone's beat, opened; null when it does not open (another squad, a key you do not hold, a swapped row). */
export async function openPresence(rec: SquadRec, member: string, ct: string | null | undefined, gen: number | null | undefined): Promise<PresenceBody | null> {
  if (!ct || !Number.isInteger(gen)) return null;
  const raw = keyFor(rec, gen as number);
  if (!raw) return null;
  try { return cleanPresence(await S.open(raw, ct, presenceAad(rec.squadId, member, gen as number))); } catch { return null; }
}

/** One row of the hub's `seen` list (PS 1.64 hub): the last beat (null after the person switched "working" off). */
export interface SeenRow { id: string; at: string | null; ct: string | null; gen: number | null }
export function cleanSeenRows(v: unknown): SeenRow[] {
  if (!Array.isArray(v)) return [];
  const out: SeenRow[] = [];
  for (const r of v.slice(0, 300)) {
    const o = r as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || typeof o.id !== "string" || !UUID.test(o.id)) continue;
    out.push({ id: o.id.toLowerCase(), at: iso(o.at), ct: typeof o.ct === "string" && o.ct.length <= 600 ? o.ct : null, gen: Number.isInteger(o.gen) ? o.gen as number : null });
  }
  return out;
}

export type StatusKind = "gym" | "online" | "seen" | "none";
export interface MemberStatus { kind: StatusKind; label: string }
/** What a member's row says. seen/gym: what the hub's list gave (undefined: this hub does not send it yet);
 *  working: the hub's older "working now" set (beat in the last 7 minutes), used only when the list is not there. */
export function memberStatus(m: { shares: boolean; seen?: string | null; gym?: string | null; working: boolean; known: boolean }, now: number): MemberStatus {
  if (!m.shares) return { kind: "none", label: "" };
  const gym = m.gym ? Date.parse(m.gym) : NaN;
  if (Number.isFinite(gym) && now - gym < GYM_MS && gym - now < 5 * 60_000) return { kind: "gym", label: "At the gym" };
  if (!m.known) return m.working ? { kind: "online", label: "Online" } : { kind: "none", label: "" };
  const at = m.seen ? Date.parse(m.seen) : NaN;
  if (!Number.isFinite(at)) return { kind: "none", label: "" };
  const ago = now - at;
  if (ago < ONLINE_MS) return { kind: "online", label: "Online" };
  if (ago > SEEN_DAYS * 86_400_000) return { kind: "none", label: "" };
  return { kind: "seen", label: `Last seen ${agoText(ago)}` };
}
/** "20 min ago", "2 h ago", "yesterday", "3 days ago". */
export function agoText(ms: number): string {
  const m = Math.max(1, Math.floor(ms / 60_000));
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
/** Order in the list: you first, then at the gym, online, by last seen, then the rest by name. */
export function statusOrder(a: { me: boolean; name: string; st: MemberStatus; seen?: string | null }, b: { me: boolean; name: string; st: MemberStatus; seen?: string | null }): number {
  const rank = (k: StatusKind) => (k === "gym" ? 0 : k === "online" ? 1 : k === "seen" ? 2 : 3);
  return Number(b.me) - Number(a.me) || rank(a.st.kind) - rank(b.st.kind)
    || (a.st.kind === "seen" ? Date.parse(b.seen ?? "") - Date.parse(a.seen ?? "") : 0) || a.name.localeCompare(b.name);
}
