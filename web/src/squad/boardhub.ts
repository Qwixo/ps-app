// G Squad (V1.40): the only code that talks to the hub's `board` function (Leaderboard and Screen time cards). The same
// signed request format as squad/hub.ts; no vault and no screen here, so the live check (scripts/gsquad-board-hub-check.ts)
// runs the very same calls PS makes. It never seals anything: rows come from core/squadboard.ts planBoardSync (the gate).
import * as S from "../core/squadcrypto.ts";
import { signRequest } from "../core/squadcrypto.ts";
import { keyFor, type SquadRec } from "../core/squadrec.ts";
import { boardAad, cleanCard, type BoardKind, type BoardRow, type HeldCard } from "../core/squadboard.ts";
import type { PastRow } from "../core/squadpast.ts";
import { HUB_URL, HubError, hubBytes } from "./hub.ts";
import { hubAwake } from "./hub";
export const BOARD_FN = `${HUB_URL}/functions/v1/board`;
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** One signed call to the board function (the same request format and checks as the core's squad function). */
export async function boardCall<T = unknown>(rec: Pick<SquadRec, "memberId" | "sign">, act: string, args: unknown, fetcher: Fetcher = (u, i) => fetch(u, i)): Promise<T> {
  hubAwake();   // PS 1.65 Low power mode: no hub call at all while G Squad sleeps
  const body = JSON.stringify(await signRequest(rec.sign.priv, act, rec.memberId, args));
  const init: RequestInit = { method: "POST", headers: { "Content-Type": "application/json" }, body };
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") init.signal = AbortSignal.timeout(20_000);
  const res = await fetcher(BOARD_FN, init);
  const text = await res.text();
  const b = (hubBytes[act] ??= { calls: 0, up: 0, down: 0 });
  b.calls++; b.up += body.length; b.down += text.length;
  let j: unknown = null;
  try { j = JSON.parse(text); } catch { /* below */ }
  if (!res.ok) throw new HubError(res.status, (j as { error?: string } | null)?.error || `board ${res.status}`);
  return j as T;
}
export interface PastPullRow { month: string; ct: string; gen: number; fp: string; deleted: boolean; updated_at: string }
export interface BoardPullRow { member_id: string; kind: BoardKind; ct: string; gen: number; deleted: boolean; updated_at: string }
export function boardApi(rec: Pick<SquadRec, "memberId" | "sign">, fetcher?: Fetcher) {
  return {
    mine: () => boardCall<{ rows: { kind: BoardKind; fp: string }[] }>(rec, "board_mine", {}, fetcher),
    put: (rows: BoardRow[]) => boardCall<{ ok: true }>(rec, "board_put", { rows }, fetcher),
    del: (kinds: BoardKind[]) => boardCall<{ ok: true }>(rec, "board_del", { kinds }, fetcher),
    pull: (since: string | null) => boardCall<{ now: string; rows: BoardPullRow[] }>(rec, "board_pull", { since }, fetcher),
    // PS 1.64 Past boards (core/squadpast.ts): every member reads; only the squad's owner writes (the hub checks).
    past: (since: string | null) => boardCall<{ now: string; rows: PastPullRow[] }>(rec, "board_past", { since }, fetcher),
    pastPut: (rows: PastRow[], del: string[]) => boardCall<{ ok: true }>(rec, "board_pastput", { rows, del }, fetcher),
  };
}
/** Opens the cards a pull brought into `cards` (member to kind to card); a card that does not open is dropped. */
export async function takeBoardRows(rec: SquadRec, rows: BoardPullRow[], cards: Map<string, Map<BoardKind, HeldCard>>): Promise<void> {
  for (const r of rows) {
    const mine = cards.get(r.member_id) ?? new Map<BoardKind, HeldCard>();
    cards.set(r.member_id, mine);
    if (r.deleted) { mine.delete(r.kind); continue; }
    const raw = keyFor(rec, r.gen);
    if (!raw) { mine.delete(r.kind); continue; }
    try {
      const card = cleanCard(r.kind, await S.open(raw, r.ct, boardAad(rec.squadId, r.member_id, r.kind, r.gen)));
      if (card) mine.set(r.kind, { kind: r.kind, card, at: r.updated_at }); else mine.delete(r.kind);
    } catch { mine.delete(r.kind); }
  }
}

