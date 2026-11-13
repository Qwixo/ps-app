// G Squad Fitness (V1.40): the steps between your Fitness and the hub that need no vault, so the engine
// (squad/gym.ts) and the live hub check (scripts/gym-hub-check.ts) run the very same code.
// What you share is decided in gymWanted (nothing for a switched off piece) and sealed only through
// core/squadshare.ts sealForSquad (which refuses a switched off piece again, before it touches the key).
import type { FitPrefs, FitWorkout } from "../core/fitness.ts";
import type { FitActivity } from "../core/activity.ts";
import type { SleepLog } from "../core/sleep.ts";
import { currentKey, keyFor, type SquadRec } from "../core/squadrec.ts";
import { sealForSquad, shareOn, type ShareOpts } from "../core/squadshare.ts";
import { copyFp, open as openSealed, signRequest } from "../core/squadcrypto.ts";
import { HUB_URL, HubError, hubBytes } from "./hub.ts";
import { buildExRows, buildSleep, buildSum, cleanPost, exTag, gymAad, gymRowId, type GymPost } from "../core/gymsquad.ts";

export type GymPart = "sum" | "sleep" | "ex";
export interface Want { id: string; part: GymPart; tag?: string; value: unknown; piece: "fitness" | "sleep" }
export interface GymRowOut { id: string; part: GymPart; tag?: string; ct: string; gen: number; fp: string }
export interface GymInput {
  workouts: { id: string; data: FitWorkout }[];
  acts: { id: string; data: FitActivity }[];
  prefs: FitPrefs;
  today: string;
  sleepLogs: Iterable<SleepLog>;
  sleepToday: string;
}
/** Sleep is shared only when the G Squad Sleep switch AND the Sleep screen's own sharing are on. */
export const sleepOn = (opts: ShareOpts | null | undefined, prefs: FitPrefs) => shareOn(opts, "sleep") && prefs.sleepShare !== false;

export async function gymWanted(r: SquadRec, opts: ShareOpts | null | undefined, x: GymInput): Promise<Want[]> {
  const out: Want[] = [];
  const key = currentKey(r);
  if (shareOn(opts, "fitness")) {
    out.push({ id: await gymRowId(r.secret, "sum"), part: "sum", value: buildSum(x.workouts, x.acts, x.today, x.prefs.weekGoal), piece: "fitness" });
    for (const ex of buildExRows(x.workouts, x.acts, x.today)) out.push({ id: await gymRowId(r.secret, `ex:${ex.m}`), part: "ex", tag: await exTag(key.raw, ex.m), value: ex, piece: "fitness" });
  }
  if (sleepOn(opts, x.prefs)) {
    const card = buildSleep(x.sleepLogs, x.prefs, x.sleepToday);
    if (card) out.push({ id: await gymRowId(r.secret, "sleep"), part: "sleep", value: card, piece: "sleep" });
  }
  return out;
}
/** Sealed puts for new or changed rows, and the ids the hub should drop. `have`: row id to fingerprint on the hub now. */
export async function gymPlan(r: SquadRec, opts: ShareOpts | null | undefined, want: Want[], have: Map<string, { fp: string }>): Promise<{ put: GymRowOut[]; del: string[] }> {
  const key = currentKey(r);
  const put: GymRowOut[] = [];
  for (const x of want) {
    const fp = await copyFp(r.secret, { p: x.part, t: x.tag ?? null, v: x.value }, key.gen);
    if (have.get(x.id)?.fp === fp) continue;
    const s = await sealForSquad(opts, x.piece, key, x.value, gymAad.row(r.squadId, r.memberId, x.id, x.part, key.gen));
    if (!s) continue;
    put.push({ id: x.id, part: x.part, ...(x.tag ? { tag: x.tag } : {}), ct: s.ct, gen: s.gen, fp });
  }
  const keep = new Set(want.map((x) => x.id));
  return { put, del: [...have.keys()].filter((id) => !keep.has(id)) };
}

export interface RowIn { id: string; member_id: string; part: GymPart; tag: string | null; ct: string; gen: number; deleted: boolean; updated_at: string }
export interface PostIn { id: string; member_id: string; ct: string; gen: number; deleted: boolean; updated_at: string }
/** Opens one row someone shared. `undefined`: we do not hold that key gen yet. `null`: it does not open (moved, forged). */
export async function openGymRow(r: SquadRec, row: RowIn): Promise<unknown | null | undefined> {
  const raw = keyFor(r, row.gen);
  if (!raw) return undefined;
  try { return await openSealed(raw, row.ct, gymAad.row(r.squadId, row.member_id, row.id, row.part, row.gen)); } catch { return null; }
}
export async function openGymPost(r: SquadRec, p: PostIn): Promise<GymPost | null | undefined> {
  const raw = keyFor(r, p.gen);
  if (!raw) return undefined;
  try { return cleanPost(await openSealed(raw, p.ct, gymAad.post(r.squadId, p.member_id, p.id, p.gen))); } catch { return null; }
}
/** Posts (challenges, joins, reactions, comments) are Fitness: switched off, nothing is sealed (null). */
export async function sealGymPost(r: SquadRec, opts: ShareOpts | null | undefined, id: string, value: GymPost) {
  const key = currentKey(r);
  return sealForSquad(opts, "fitness", key, value, gymAad.post(r.squadId, r.memberId, id, key.gen));
}

// ---------- transport: the hub's `gym` function, every request signed with your own key ----------
export const GYM_FN = `${HUB_URL}/functions/v1/gym`;
const LIMIT_MS = 20_000;
export type GymFetch = (url: string, init: RequestInit) => Promise<Response>;
export async function gymCall<T>(who: { member: string; priv: string }, act: string, args: unknown, fetcher: GymFetch = (u, i) => fetch(u, i)): Promise<T> {
  const req = await signRequest(who.priv, act, who.member, args);
  const body = JSON.stringify(req);
  const init: RequestInit = { method: "POST", headers: { "Content-Type": "application/json" }, body };
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") init.signal = AbortSignal.timeout(LIMIT_MS);
  const res = await fetcher(GYM_FN, init);
  const text = await res.text();
  const b = (hubBytes[act] ??= { calls: 0, up: 0, down: 0 });
  b.calls++; b.up += body.length; b.down += text.length;
  let j: unknown = null;
  try { j = JSON.parse(text); } catch { /* below */ }
  if (!res.ok) throw new HubError(res.status, (j as { error?: string } | null)?.error || `hub ${res.status}`);
  return j as T;
}
export interface PullOut { now: string; gen: number; members: { id: string; card_ct: string | null; card_gen: number | null }[]; rows: RowIn[]; posts: PostIn[]; ex: RowIn[] }
