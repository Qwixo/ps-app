// G Squad GIFs (PS 1.63): the only code that talks to the hub's `gif` function (its own function next to `squad` and `chat`).
// Signed exactly like the chat (core/squadcrypto.ts signRequest, the member's own key). The hub holds the GIPHY key; this
// side never sees it. Returns only the picker's list, every address checked again here (chatgif.ts) before it is used.
import { signRequest } from "../core/squadcrypto.ts";
import { HUB_URL, HubError, hubBytes, type HubIdent } from "./hub.ts";
import { cleanGifItems, cleanGifQuery, type GifItem } from "./chatgif.ts";

export const GIF_FN = `${HUB_URL}/functions/v1/gif`;
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
const LIMIT_MS = 12_000;

async function gifCall<T>(who: HubIdent, act: string, args: unknown, fetcher: Fetcher): Promise<T> {
  const req = await signRequest(who.priv, act, who.member, args);
  const body = JSON.stringify(req);
  const init: RequestInit = { method: "POST", headers: { "Content-Type": "application/json" }, body };
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") init.signal = AbortSignal.timeout(LIMIT_MS);
  const res = await fetcher(GIF_FN, init);
  const text = await res.text();
  const b = (hubBytes[act] ??= { calls: 0, up: 0, down: 0 });
  b.calls++; b.up += body.length; b.down += text.length;
  let j: unknown = null;
  try { j = JSON.parse(text); } catch { /* below */ }
  if (!res.ok) throw new HubError(res.status, (j as { error?: string } | null)?.error || `hub ${res.status}`);
  return j as T;
}

export function gifApi(who: HubIdent, fetcher: Fetcher = (u, i) => fetch(u, i)) {
  return {
    /** Is the function deployed and the key set? Any trouble (not deployed, offline, an error) counts as no. */
    async status(): Promise<boolean> {
      try { return (await gifCall<{ on?: unknown }>(who, "g_status", {}, fetcher)).on === true; } catch { return false; }
    },
    async search(q: string, pos = 0): Promise<{ items: GifItem[]; next: number | null }> {
      const j = await gifCall<{ items?: unknown; next?: unknown }>(who, "g_search", { q: cleanGifQuery(q), pos: Number.isInteger(pos) && pos >= 0 && pos <= 400 ? pos : 0 }, fetcher);
      return { items: cleanGifItems(j.items), next: Number.isInteger(j.next) ? (j.next as number) : null };
    },
  };
}
export type GifApi = ReturnType<typeof gifApi>;
