// G Squad GIF search (PS 1.63), the rules of the hub function `gif`, with no Deno or npm import so the same code runs on
// the hub (index.ts) and in the unit tests (with a fake fetch, never GIPHY). The function proxies GIPHY's search so the
// key (the hub secret GIPHY_API_KEY, set by the owner, never in code) never reaches a device, and so a device never
// has to ask GIPHY directly. It hands back only what the picker needs: an id, a small GIF address, a still picture
// address, the size and a short title, all on GIPHY's media hosts over https. Ratings above pg-13 are never asked for.
export const RATING = "pg-13";
export const PAGE = 24, MAX_POS = 400, QUERY_MAX = 60, PER_MINUTE = 20, CACHE_MS = 60_000;
export const HOST = /^(?:media\d?|i)\.giphy\.com$/;
const PATH = /^\/(?:media|v1)(?:\/[A-Za-z0-9._~-]{1,200}){1,6}\.(?:gif|webp)$/;
const QUERY = /^\?[A-Za-z0-9_=&.%~-]{0,240}$/;

export class Fail extends Error { code: number; constructor(code: number, msg: string) { super(msg); this.code = code; } }
export type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface GifOut { id: string; url: string; still: string; w: number; h: number; title: string }

/** What was typed, cleaned: no control characters, one space between words, 60 characters at most. Empty means trending. */
export function cleanQuery(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new Fail(400, "bad query");
  return v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, QUERY_MAX);
}
/** The place to continue from: a whole number from 0 to 400. */
export function cleanPos(v: unknown): number {
  if (v === undefined || v === null) return 0;
  if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > MAX_POS) throw new Fail(400, "bad number");
  return v as number;
}
/** An address from GIPHY is kept only when it is https on a media host, with a plain picture path. */
export function safeUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 400 || /\s/.test(v)) return null;
  let u: URL;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== "https:" || !HOST.test(u.hostname) || u.port || u.username || u.password || u.hash) return null;
  if (!PATH.test(u.pathname) || (u.search && !QUERY.test(u.search))) return null;
  return u.href;
}
export function searchUrl(key: string, q: string, pos: number): string {
  const p = new URLSearchParams({ api_key: key, limit: String(PAGE), offset: String(pos), rating: RATING, lang: "en", bundle: "messaging_non_clips" });
  if (q) p.set("q", q);
  return `https://api.giphy.com/v1/gifs/${q ? "search" : "trending"}?${p}`;
}
/** GIPHY's answer cut down to what the picker shows. Anything odd is skipped; nothing from GIPHY is passed on as is. */
export function shape(j: unknown): { items: GifOut[]; next: number | null } {
  const root = (j && typeof j === "object" ? j : {}) as { data?: unknown; pagination?: { offset?: unknown; count?: unknown; total_count?: unknown } };
  const items: GifOut[] = [];
  for (const g of Array.isArray(root.data) ? root.data : []) {
    if (!g || typeof g !== "object") continue;
    const o = g as { id?: unknown; title?: unknown; rating?: unknown; images?: Record<string, { url?: unknown; width?: unknown; height?: unknown } | undefined> };
    if (typeof o.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(o.id)) continue;
    if (typeof o.rating === "string" && !["g", "pg", "pg-13"].includes(o.rating.toLowerCase())) continue;
    const im = o.images ?? {};
    const main = im.fixed_width ?? im.fixed_width_small ?? im.downsized;
    const url = safeUrl(main?.url);
    const still = safeUrl((im.fixed_width_still ?? im.fixed_width_small_still ?? im.downsized_still)?.url) ?? url;
    if (!url || !still) continue;
    const w = Number(main?.width), h = Number(main?.height);
    items.push({ id: o.id, url, still, w: Number.isFinite(w) && w >= 20 && w <= 1000 ? Math.round(w) : 200, h: Number.isFinite(h) && h >= 20 && h <= 1000 ? Math.round(h) : 200,
      title: typeof o.title === "string" ? o.title.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 80) : "" });
    if (items.length >= PAGE) break;
  }
  const pg = root.pagination ?? {};
  const off = Number(pg.offset), cnt = Number(pg.count), tot = Number(pg.total_count);
  const next = Number.isFinite(off) && Number.isFinite(cnt) && cnt > 0 && (!Number.isFinite(tot) || off + cnt < tot) && off + cnt <= MAX_POS ? off + cnt : null;
  return { items, next };
}

/** One search. The key is passed in (from the hub secret), never stored here. */
export async function search(fetcher: Fetcher, key: string, args: { q?: unknown; pos?: unknown }): Promise<{ on: true; items: GifOut[]; next: number | null }> {
  if (!key) throw new Fail(503, "not set up");
  const q = cleanQuery(args.q), pos = cleanPos(args.pos);
  let r;
  try { r = await fetcher(searchUrl(key, q, pos), typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? { signal: AbortSignal.timeout(8000) } : {}); }
  catch { throw new Fail(502, "gif service"); }
  if (!r.ok) throw new Fail(r.status === 429 ? 429 : 502, r.status === 429 ? "slow" : "gif service");
  let j: unknown;
  try { j = await r.json(); } catch { throw new Fail(502, "gif service"); }
  return { on: true, ...shape(j) };
}
/** Whether a member may ask again: `recent` is how many asks they made in the last minute. */
export const allowed = (recent: number) => recent < PER_MINUTE;
