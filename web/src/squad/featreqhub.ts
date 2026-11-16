// G Squad "Feature requests" (PS 1.65): the only code that talks to the hub's `featreq` function (supabase/hub/functions/featreq,
// migration featreq_001_requests.sql) and seals or opens a request. Same signed request format as the other hub functions
// (core/squadcrypto.ts). THE HUB PART IS NEW: until the developer deploys that migration and function, the hub answers 404, a request
// stays on this device ("waiting") and the squad's list stays hidden. Nothing breaks and nothing polls: a send happens once per request,
// a read only on a click in Settings, then only what changed since.
import * as S from "../core/squadcrypto.ts";
import { signRequest } from "../core/squadcrypto.ts";
import { currentKey, keyFor, type SquadRec } from "../core/squadrec.ts";
import { cleanRequest, frAad, mergeSquadList, type FeatureRequest, type SquadRow } from "../core/featreq.ts";
import { HUB_URL, HubError, hubBytes } from "./hub.ts";

export const FR_FN = `${HUB_URL}/functions/v1/featreq`;
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export async function frCall<T = unknown>(rec: Pick<SquadRec, "memberId" | "sign">, act: string, args: unknown, fetcher: Fetcher = (u, i) => fetch(u, i)): Promise<T> {
  const body = JSON.stringify(await signRequest(rec.sign.priv, act, rec.memberId, args));
  const init: RequestInit = { method: "POST", headers: { "Content-Type": "application/json" }, body };
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") init.signal = AbortSignal.timeout(20_000);
  const res = await fetcher(FR_FN, init);
  const text = await res.text();
  const b = (hubBytes[act] ??= { calls: 0, up: 0, down: 0 });
  b.calls++; b.up += body.length; b.down += text.length;
  let j: unknown = null;
  try { j = JSON.parse(text); } catch { /* below */ }
  if (!res.ok) throw new HubError(res.status, (j as { error?: string } | null)?.error || `featreq ${res.status}`);
  return j as T;
}
/** The request, sealed with the squad key: the hub stores only scrambled text, the id and the key's generation. */
export async function sealRequest(rec: SquadRec, req: FeatureRequest): Promise<{ id: string; gen: number; ct: string }> {
  const { raw, gen } = currentKey(rec);
  return { id: req.id, gen, ct: await S.seal(raw, req, frAad(S.V, rec.squadId, rec.memberId, req.id)) };
}
/** Sends one. "missing" when the hub has no Feature requests part yet (404 or 'not found'), which is not an error. */
export async function sendRequest(rec: SquadRec, req: FeatureRequest, fetcher?: Fetcher): Promise<"sent" | "missing"> {
  const sealed = await sealRequest(rec, req);
  try { await frCall(rec, "fr_put", sealed, fetcher); return "sent"; }
  catch (e) {
    if (e instanceof HubError && e.status === 409 && e.message === "exists") return "sent";   // it got there on an earlier try
    if (e instanceof HubError && (e.status === 404 || e.status === 405)) return "missing";
    throw e;
  }
}
export async function deleteRequest(rec: SquadRec, id: string, fetcher?: Fetcher): Promise<"sent" | "missing"> {
  try { await frCall(rec, "fr_del", { id }, fetcher); return "sent"; }
  catch (e) { if (e instanceof HubError && (e.status === 404 || e.status === 405)) return "missing"; throw e; }
}

/** The squad's requests, opened with the squad key: the whole list the first time (`since` null), then only what changed. Rows that do
 *  not open (an older key, a wrong aad, anything not a request) are skipped. "missing" while the hub has no Feature requests part. */
export async function pullRequests(rec: SquadRec, list: SquadRow[], since: string | null, fetcher?: Fetcher): Promise<{ list: SquadRow[]; since: string | null } | "missing"> {
  let res: { now: string; rows: { id: string; member_id: string; ct: string; gen: number; deleted: boolean }[] };
  try { res = await frCall(rec, "fr_pull", { since }, fetcher); }
  catch (e) { if (e instanceof HubError && (e.status === 404 || e.status === 405)) return "missing"; throw e; }
  const opened: { id: string; gone: boolean; req?: FeatureRequest; mine: boolean }[] = [];
  for (const r of Array.isArray(res?.rows) ? res.rows.slice(0, 200) : []) {
    if (!r || typeof r.id !== "string") continue;
    if (r.deleted) { opened.push({ id: r.id, gone: true, mine: false }); continue; }
    const raw = keyFor(rec, r.gen);
    if (!raw) continue;
    try {
      const req = cleanRequest(await S.open(raw, r.ct, frAad(S.V, rec.squadId, String(r.member_id), r.id)));
      if (req && req.id === r.id) opened.push({ id: r.id, gone: false, req, mine: r.member_id === rec.memberId });
    } catch { /* not ours to open */ }
  }
  return { list: mergeSquadList(list, opened), since: typeof res?.now === "string" ? res.now : since };
}
