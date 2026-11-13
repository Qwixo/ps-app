// G Squad directory (V1.42): the steps, with no vault and no screen in them, so the engine (main page) and the live
// hub check (scripts/gsquad-dir-hub-check.ts) run the very same code. Crypto and checks: core/squaddir.ts.
import * as S from "../core/squadcrypto.ts";
import { cleanName, sealCard, type SquadRec } from "../core/squadrec.ts";
import { approveMaterial, cleanDir, LISTED_NAME, makeAsk, openAsk, recFromApproval, type AskRec, type AskView } from "../core/squaddir.ts";
import { HubError, hubAsk, hubAskCancel, hubAskStatus, hubCreateListed, hubDir, type HubApi } from "./hub.ts";
import { apiFor } from "./flows.ts";

type Fetcher = Parameters<typeof hubDir>[1];

/** The listed squads (a throwaway key signs the look, or your request's key if you have one). */
export async function listSquads(sign?: { pub: string; priv: string } | null, fetcher?: Fetcher) {
  const key = sign ?? await S.newSignPair();
  return cleanDir((await hubDir(key, fetcher)).squads);
}

/** Make "The G Squad" and list it with a one-time claim code. V1.49: PS no longer calls this (the hub makes The G Squad
 *  by itself and migration auto_001 spent the claim); only the old live hub check (scripts/gsquad-dir-hub-check.ts) uses it. */
export async function createListedSquad(code: string, me: string, fetcher?: Fetcher): Promise<SquadRec> {
  const [sign, box, raw] = await Promise.all([S.newSignPair(), S.newBoxPair(), S.newSquadKey()]);
  const id = S.newUuid();
  const meta = await S.seal(raw, { n: LISTED_NAME }, S.sqAad.meta(id, 1));
  const r = await hubCreateListed(id, sign, box.pub, meta, code.trim(), fetcher);
  const rec: SquadRec = { v: 1, squadId: r.squad, memberId: r.member, me: cleanName(me) || "Me", keys: [{ gen: r.gen, k: raw }], sign, box,
    secret: S.newSecret(), joinedAt: new Date().toISOString(), creator: true };
  const card = await sealCard(rec, rec.me);
  await apiFor(rec, fetcher).card(card.ct, card.gen);
  return rec;
}

/** Ask to join a listed squad. Returns the record to keep in your vault (it holds the keys you will join with). */
export async function askToJoin(entry: { id: string; name: string; adminBox: string }, me: string, old?: AskRec | null, fetcher?: Fetcher): Promise<AskRec> {
  const a = await makeAsk(entry, me, old);
  await hubAsk(a.rec.sign, a.hub, fetcher);
  return a.rec;
}

export type AskOutcome = { state: "open" } | { state: "declined" | "cancelled"; at: string } | { state: "gone" } | { state: "in"; rec: SquadRec };
/** Where your request stands; approved means you are in (the squad key opened with your box key). */
export async function checkAsk(a: AskRec, fetcher?: Fetcher): Promise<AskOutcome> {
  const s = await hubAskStatus(a.sign, fetcher);
  if (s.state === "none" || (s.id && s.id !== a.reqId && s.state !== "approved")) return { state: "gone" };
  if (s.state === "open") return { state: "open" };
  if (s.state === "declined" || s.state === "cancelled") return { state: s.state, at: s.at || new Date().toISOString() };
  if (s.state === "approved" && s.member && s.squad && s.drop) {
    const rec = await recFromApproval(a, { squad: s.squad, member: s.member, drop: s.drop, at: s.at });
    const card = await sealCard(rec, rec.me);
    await apiFor(rec, fetcher).card(card.ct, card.gen);   // your own card, as on joining with a link
    return { state: "in", rec };
  }
  return { state: "gone" };
}
export const cancelAsk = (a: AskRec, fetcher?: Fetcher) => hubAskCancel(a.sign, fetcher);

/** The admin: open requests, each opened and checked against the hub's keys. */
export async function loadAsks(rec: SquadRec, api: HubApi): Promise<AskView[]> {
  const rows = (await api.asks()).rows ?? [];
  return Promise.all(rows.map((r) => openAsk(rec, r)));
}
/** The admin lets them in: the squad key goes to their box key through the key drop. */
export async function approveAsk(rec: SquadRec, api: HubApi, ask: AskView): Promise<void> {
  await api.approve(await approveMaterial(rec, ask));
}

/** What a directory step's failure says on screen (V1.44: a dropped connection or a timeout says so, it never looks
 *  like an empty list or a bare "Failed to fetch"). */
export function sayDir(e: unknown): string {
  if (e instanceof HubError) {
    const s = e.status, m = e.message;
    if (s === 403 && /claim/.test(m)) return "That claim code is not right, or a squad is already listed.";
    if (s === 429 && /wait/.test(m)) return "You asked a moment ago. Try again in an hour.";
    if (s === 429) return "Lots of people are asking right now. Try again later.";
    if (s === 404 && /unlisted/.test(m)) return "That squad is not open to join right now.";
    if (s === 409 && /admin changed/.test(m)) return "That squad has a new admin. Open the list again and ask again.";
    if (s === 409 && /already in/.test(m)) return "You are already in that squad.";
    if (s === 409 && /already asked/.test(m)) return "You already asked. Wait for an answer.";
    if (s === 409 && /rekey/.test(m)) return "The squad is changing keys. Try again in a moment.";
    if (s === 409 && /full/.test(m)) return "That squad is full.";
    if (s === 401 && /clock/.test(m)) return "This device's clock is off. Set the date and time to automatic and try again.";
    if (s >= 500) return "The G Squad server had a problem. Try again in a moment.";
    return "G Squad could not be reached. Try again in a moment.";
  }
  const name = (e as { name?: unknown } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") return "G Squad took too long to answer. Check your internet and try again.";
  if (e instanceof TypeError && /fetch|network|load failed|connection/i.test(e.message)) return "G Squad could not be reached. Check your internet and try again.";
  return e instanceof Error && e.message.length < 120 ? e.message : "Something went wrong. Try again.";
}
