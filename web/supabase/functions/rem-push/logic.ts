// The reminder sender's rules with no network in them (tests/rempush.test.ts runs them with a fake sender).
// A push carries only the reminder's id and when it was due: never its words (they stay in the vault and on the phone).
export interface DueRow { id: number; rem_id: string; fire_at: string; sub: { id: string; endpoint: string; p256dh: string; auth: string } }
export const MAX_BATCH = 200;
/** A request is the project's own scheduler when its key matches the one in push_config (never empty). */
export function authorised(sent: string | null | undefined, kept: string | null | undefined): boolean {
  return !!sent && !!kept && sent.length === kept.length && sent === kept;
}
/** What goes in the push body. */
export function payloadOf(row: Pick<DueRow, "rem_id" | "fire_at">): string {
  return JSON.stringify({ t: "rem", id: row.rem_id, at: Date.parse(row.fire_at) || 0 });
}
/** A push service says the address is gone for good (the app was removed, the person turned notifications off). */
export const isGone = (status: number) => status === 404 || status === 410;
export interface Outcome { sent: number[]; failed: number[]; goneSubs: string[] }
/** Send every due row through `send` (never more than MAX_BATCH, never one that is late by over an hour: stale is dropped). */
export async function sendBatch(rows: DueRow[], send: (sub: DueRow["sub"], body: string) => Promise<{ status: number }>, now: number): Promise<Outcome> {
  const out: Outcome = { sent: [], failed: [], goneSubs: [] };
  for (const r of rows.slice(0, MAX_BATCH)) {
    if (out.goneSubs.includes(r.sub.id)) continue;
    if (now - Date.parse(r.fire_at) > 3_600_000) { out.sent.push(r.id); continue; }   // too late to be useful: closed out, not sent
    try {
      const res = await send(r.sub, payloadOf(r));
      if (res.status >= 200 && res.status < 300) out.sent.push(r.id);
      else if (isGone(res.status)) out.goneSubs.push(r.sub.id);
      else out.failed.push(r.id);
    } catch { out.failed.push(r.id); }
  }
  return out;
}
