// G Squad GIFs (PS 1.63, feature "gsquad-signal"): what a GIF message is, which web addresses may ever be loaded for one,
// and how the GIF picker's list is checked. Rules only. A GIF is an ordinary sealed text message whose whole text is one
// GIPHY media address, so people on an older PS just see the link. Pictures load straight from GIPHY's media servers, and only
// from them: anything else in a message stays plain text. The hub function `gif` (supabase/hub/functions/gif/logic.ts) uses
// the same host rule on its side.
export const GIF_HOST = /^(?:media\d?|i)\.giphy\.com$/;
const PATH = /^\/(?:media|v1)(?:\/[A-Za-z0-9._~-]{1,200}){1,6}\.(?:gif|webp)$/;
const QUERY = /^\?[A-Za-z0-9_=&.%~-]{0,240}$/;

/** The address if it is an https GIPHY media picture (gif or webp), else null. No other port, no login in it. */
export function gifUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 400 || /\s/.test(v)) return null;
  let u: URL;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== "https:" || !GIF_HOST.test(u.hostname) || u.port || u.username || u.password || u.hash) return null;
  if (!PATH.test(u.pathname) || (u.search && !QUERY.test(u.search))) return null;
  return u.href;
}
/** The still picture of a GIPHY GIF (200w.gif has 200w_s.gif, giphy.gif has giphy_s.gif), or the same address when it does not
 *  look like one: shown first when Reduce motion is on, until the person hovers or taps. */
export function stillOf(url: string): string {
  const u = gifUrl(url);
  if (!u) return url;
  const still = u.replace(/\/([A-Za-z0-9]+)\.gif(\?|$)/, "/$1_s.gif$2");
  return gifUrl(still) ?? u;
}
/** A message's text, when it is a GIF: the whole text is one allowed address. */
export function parseGifMessage(text: string): string | null {
  return gifUrl(text.trim());
}

export interface GifItem { id: string; url: string; still: string; w: number; h: number; title: string }
/** The picker's list as the Tab list receives it: only entries whose addresses pass, sizes sane, text short. */
export function cleanGifItems(v: unknown, max = 30): GifItem[] {
  if (!Array.isArray(v)) return [];
  const out: GifItem[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const url = gifUrl(o.url), still = gifUrl(o.still) ?? url;
    const w = Number(o.w), h = Number(o.h);
    if (!url || !still || typeof o.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(o.id)) continue;
    out.push({ id: o.id, url, still, w: Number.isFinite(w) && w >= 20 && w <= 1000 ? Math.round(w) : 200, h: Number.isFinite(h) && h >= 20 && h <= 1000 ? Math.round(h) : 200,
      title: typeof o.title === "string" ? o.title.replace(/[\u0000-\u001f]/g, " ").slice(0, 80) : "" });
    if (out.length >= max) break;
  }
  return out;
}
/** What you type in the picker's search: no control characters, one space between words, at most 60 characters. */
export function cleanGifQuery(v: unknown): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) : "";
}

/** Whether the GIF button is shown: the feature, and the hub said yes (null = not asked yet, hidden). */
export const gifButton = (featureOn: boolean, hubOn: boolean | null) => featureOn && hubOn === true;

/** The hub's answer to "is it set up" is remembered: a yes for a week, a no for 6 hours (Red may deploy any time). */
export const GIF_YES_MS = 7 * 864e5, GIF_NO_MS = 6 * 36e5;
export function gifMemory(raw: string | null, now: number): boolean | null {
  try {
    const o = JSON.parse(raw || "null") as { on?: unknown; at?: unknown } | null;
    if (!o || typeof o.on !== "boolean" || typeof o.at !== "number") return null;
    const age = now - o.at;
    if (age < 0) return null;
    return age < (o.on ? GIF_YES_MS : GIF_NO_MS) ? o.on : null;
  } catch { return null; }
}

// ---------- device choices for G Squad chat (this device only, like the look) ----------
export const LOADGIF_KEY = "gsquad.loadGifs";
/** "Load GIFs" in Squad settings: on unless switched off here. */
export function readLoadGifs(store: Pick<Storage, "getItem"> | null = safe()): boolean { try { return store?.getItem(LOADGIF_KEY) !== "off"; } catch { return true; } }
export function saveLoadGifs(on: boolean, store: Pick<Storage, "setItem"> | null = safe()) { try { store?.setItem(LOADGIF_KEY, on ? "on" : "off"); } catch { /* storage off: this session only */ } }
function safe(): Storage | null { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } }
