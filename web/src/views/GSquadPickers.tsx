// G Squad emoji and GIF pickers, the reaction bar and the GIF picture (PS 1.63, feature "gsquad-signal"). Thin parts: what is in
// the lists and how they search is squad/emoji.ts, squad/chatreact.ts and squad/chatgif.ts; the GIF search itself runs on the
// page that holds the keys (squad/chatengine.ts) and comes back in the chat view. Esc closes a picker first (squad/back.ts).
// "GIFs from GIPHY": the pictures load straight from GIPHY's media servers, and Squad settings, Appearance has "Load GIFs".
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { allEmoji, EMOJI_GROUPS, pushRecent, searchEmoji } from "../squad/emoji";
import { QUICK_EMOJI } from "../squad/chatreact";
import { chatOp, useChat } from "../squad/chatmirror";
import { readLoadGifs, saveLoadGifs, stillOf, type GifItem } from "../squad/chatgif";
import { useBack } from "../squad/back";
import { sfx } from "../ui/sfx";

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- the "Load GIFs" choice (this device) ----------
let loadNow = readLoadGifs();
const loadSubs = new Set<() => void>();
export const loadGifsStore = {
  subscribe(l: () => void) { loadSubs.add(l); return () => { loadSubs.delete(l); }; },
  get: () => loadNow,
  set(on: boolean) { loadNow = on; saveLoadGifs(on); loadSubs.forEach((f) => f()); },
};
export const useLoadGifs = () => useSyncExternalStore(loadGifsStore.subscribe, loadGifsStore.get, loadGifsStore.get);

// ---------- recent emoji (this device) ----------
const RECENT = "gsquad.emojiRecent";
function readRecent(): string[] { try { const v = JSON.parse(localStorage.getItem(RECENT) || "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 18) : []; } catch { return []; } }
function noteRecent(e: string) { try { localStorage.setItem(RECENT, JSON.stringify(pushRecent(readRecent(), e))); } catch { /* storage off */ } }

const Smile = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.6" /><path d="M8.6 14.2c.8 1.3 2 2 3.4 2s2.6-.7 3.4-2M9.2 9.8h.01M14.8 9.8h.01" /></svg>;
const Plus = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 6v12M6 12h12" /></svg>;
export const EmojiIcon = Smile;
export const GifIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="3.2" /><path d="M10 10.4a2 2 0 1 0 0 3.2v-1.1H8.9M12.8 9.8v4.4M15 14.2V9.8h2.2M15 12h1.8" /></svg>;

// ---------- the emoji picker ----------
export function EmojiPicker({ onPick, onClose, className = "", style }: { onPick: (e: string) => void; onClose: () => void; className?: string; style?: CSSProperties }) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState(() => (readRecent().length ? "recent" : "smileys"));
  const [recent, setRecent] = useState(readRecent);
  useBack(true, onClose);
  const found = q.trim() ? searchEmoji(q) : null;
  const shown = found ? found.map((x) => ({ e: x.e, name: x.name })) : group === "recent"
    ? recent.map((e) => ({ e, name: allEmoji().find((x) => x.e === e)?.name ?? "" }))
    : (EMOJI_GROUPS.find((g) => g.id === group)?.list ?? []).map((row) => { const e = row.slice(0, row.indexOf(" ")); return { e, name: allEmoji().find((x) => x.e === e)?.name ?? "" }; });
  const pick = (e: string) => { sfx.click(); noteRecent(e); setRecent(readRecent()); onPick(e); };
  return (
    <div className={`gp gp-emoji ${className}`} style={style} role="dialog" aria-label="Emoji" onMouseDown={(e) => e.stopPropagation()}>
      <input className="gp-search" value={q} placeholder="Search emoji" aria-label="Search emoji" autoFocus spellCheck={false} maxLength={30}
        onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); onClose(); } }} />
      {!found && (
        <div className="gp-tabs" role="tablist" aria-label="Emoji groups">
          {recent.length > 0 && <button type="button" role="tab" aria-selected={group === "recent"} className={group === "recent" ? "on" : ""} onClick={() => setGroup("recent")} title="Recent" aria-label="Recent">🕘</button>}
          {EMOJI_GROUPS.map((g) => <button key={g.id} type="button" role="tab" aria-selected={group === g.id} className={group === g.id ? "on" : ""} onClick={() => setGroup(g.id)} title={g.label} aria-label={g.label}>{g.icon}</button>)}
        </div>
      )}
      <div className="gp-grid" role="listbox" aria-label={found ? "Results" : "Emoji"}>
        {shown.map((x, i) => <button key={`${x.e}${i}`} type="button" role="option" aria-selected="false" className="gp-e" title={x.name} aria-label={x.name || x.e} onClick={() => pick(x.e)}>{x.e}</button>)}
        {found && !found.length && <p className="gp-none">No emoji with that name.</p>}
      </div>
    </div>
  );
}

// ---------- the GIF picker ----------
export function GifPicker({ onPick, onClose, className = "" }: { onPick: (url: string) => void; onClose: () => void; className?: string }) {
  const c = useChat();
  const [q, setQ] = useState("");
  const first = useRef(true);
  useBack(true, onClose);
  // Trending first, then what you type (after a short pause). Closing clears the list on the page that holds it.
  useEffect(() => {
    const t = window.setTimeout(() => { chatOp({ op: "gifs", q: q.trim() }); }, first.current ? 0 : 380);
    first.current = false;
    return () => window.clearTimeout(t);
  }, [q]);
  useEffect(() => () => chatOp({ op: "gifclear" }), []);
  const g = c.gif;
  return (
    <div className={`gp gp-gif ${className}`} role="dialog" aria-label="GIFs" onMouseDown={(e) => e.stopPropagation()}>
      <input className="gp-search" value={q} placeholder="Search GIFs" aria-label="Search GIFs" autoFocus spellCheck={false} maxLength={60}
        onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); onClose(); } }} />
      <div className="gp-gifs" onScroll={(e) => { const el = e.currentTarget; if (g.next !== null && !g.busy && el.scrollHeight - el.scrollTop - el.clientHeight < 120) chatOp({ op: "gifs", q: g.q, more: true }); }}>
        {g.items.map((x: GifItem) => (
          <button key={x.id} type="button" className="gp-gif-b" title={x.title || "GIF"} aria-label={x.title || "GIF"} style={{ aspectRatio: `${x.w} / ${x.h}` }}
            onClick={() => { sfx.click(); onPick(x.url); }}>
            <img src={reduced() ? x.still : x.url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} />
          </button>
        ))}
        {g.busy && <p className="gp-none">Loading...</p>}
        {!g.busy && g.failed && <p className="gp-none">GIFs could not load. Try again in a moment.</p>}
        {!g.busy && !g.failed && !g.items.length && g.q !== "" && <p className="gp-none">No GIFs for that.</p>}
      </div>
      <p className="gp-credit">GIFs from GIPHY</p>
    </div>
  );
}

// ---------- the reaction bar ----------
export function ReactBar({ onPick, onMore, mine }: { onPick: (e: string) => void; onMore: (el: HTMLElement) => void; mine: boolean }) {
  return (
    <span className={`gc-rbar${mine ? " mine" : ""}`} role="toolbar" aria-label="React">
      {QUICK_EMOJI.map((e) => <button key={e} type="button" className="gc-rb" aria-label={`React with ${e}`} onClick={() => { sfx.click(); onPick(e); }}>{e}</button>)}
      <button type="button" className="gc-rb more" aria-label="More emoji" title="More" onClick={(ev) => onMore(ev.currentTarget)}><Plus /></button>
    </span>
  );
}

// ---------- a GIF in a message ----------
/** The picture: from GIPHY's media servers only (the address was checked, squad/chatgif.ts). "Load GIFs" off shows a tap to load
 *  box first. With Reduce motion on, the still picture shows until you hover or tap it. */
export function GifImage({ url, onLoad }: { url: string; onLoad?: () => void }) {
  const allowed = useLoadGifs();
  const [asked, setAsked] = useState(false);
  const [play, setPlay] = useState(false);
  const [bad, setBad] = useState(false);
  const calm = reduced();
  if (bad) return <span className="gc-gif off">This GIF could not load.</span>;
  if (!allowed && !asked) {
    return <button type="button" className="gc-gif off" onClick={() => { sfx.click(); setAsked(true); }}>GIF. Tap to load it from GIPHY.</button>;
  }
  const src = calm && !play ? stillOf(url) : url;
  return (
    <button type="button" className="gc-gif" aria-label={calm ? (play ? "Pause GIF" : "Play GIF") : "GIF"} disabled={!calm}
      onMouseEnter={() => calm && setPlay(true)} onMouseLeave={() => calm && setPlay(false)} onClick={() => calm && setPlay((p) => !p)}>
      <img src={src} alt="GIF" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} onLoad={onLoad} onError={() => setBad(true)} />
    </button>
  );
}
