// The Soundboard screen (V1.47; the developer's words in core/soundboard.ts). Full screen, over the Tab list on the Mac, over the
// phone's home, over the website's To-do page:
//  - a grid of tiles (a frame for a video, a waveform for audio, lazily), folders, search, Audio and Video, tap to play;
//  - the player: a preview at the top right, a button moves it to the big top middle landscape view, another to full
//    screen; play, pause, previous, next, seek, volume, shuffle, repeat; the Queue (add, play next, drag to reorder,
//    audio and video mixed);
//  - right click (Mac, website) or a long press (phone) anywhere: Add files, Add folder; on a tile: its own menu;
//  - Play at a time (7:07am, days, once or loop, how loud), Use as my alarm sound, Share in the G Squad, Rename, Remove;
//  - the gear: where the files are kept (choose another folder, back to the default), Keep playing when closed.
// Esc (and the phone's back) steps back one layer at a time: a menu, a sheet, full screen, the queue, then the screen.
import { RecordingsPanel, useRecItems } from "./Recordings";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { GOS, haptic } from "../gos/bridge";
import {
  ALL_DAYS, DAY_LETTERS, LOOP_MAX_MS, SHARE_NOTE_MAX, VOL_DEF, canShare, clock, current, daysWords, filterItems, foldersOf, moveTo, nextFire, nextRepeat,
  parseTime, removeAt, setShuffle, sizeWords, timeWords, upNext, clearQueue, enqueue, playNext,
  type KindFilter, type MediaItem, type TimedPlay, type View,
} from "../core/soundboard";
import { sbState as useSbState, updQueue, WHERE, addFiles, canChooseFolder, chooseLocation, dropFiles, grantAgain, removeItems, renameItem, say, setOpen, setPrefs, stopRing, useAsAlarm, useSb } from "./store";
import { go, jump, mount, play, playAll, prime, seek, stop, toggle, applyVolume, usePlayer, nudge } from "./player";
import { useThumb } from "./thumbs";
import { clearShareNote, sbOp, shareHere, useSbShare } from "../squad/sbshare";
import { useSquad } from "../squad/mirror";

const sv = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
const I = {
  close: <svg {...sv}><path d="M6 6l12 12M18 6L6 18" /></svg>,
  plus: <svg {...sv}><path d="M12 5v14M5 12h14" /></svg>,
  search: <svg {...sv}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></svg>,
  gear: <svg {...sv}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>,
  play: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>,
  pause: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" /></svg>,
  prev: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM19 5.5v13L9.5 12z" fill="currentColor" /></svg>,
  next: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM5 5.5v13L14.5 12z" fill="currentColor" /></svg>,
  shuffle: <svg {...sv}><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>,
  repeat: <svg {...sv}><path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>,
  queue: <svg {...sv}><path d="M3 6h13M3 12h13M3 18h8M18 15v6M15 18h6" /></svg>,
  alarm: <svg {...sv}><circle cx="12" cy="13" r="7.5" /><path d="M12 9.5V13l2.5 1.5M4 4.5L7 2M20 4.5L17 2" /></svg>,
  corner: <svg {...sv}><rect x="3" y="4" width="18" height="16" rx="2.5" /><rect x="12.5" y="6.5" width="6.5" height="4.5" rx="1" fill="currentColor" stroke="none" /></svg>,
  wide: <svg {...sv}><rect x="3" y="4" width="18" height="16" rx="2.5" /><rect x="5.5" y="6.5" width="13" height="7.5" rx="1" fill="currentColor" stroke="none" /></svg>,
  full: <svg {...sv}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>,
  exitFull: <svg {...sv}><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>,
  vol: <svg {...sv}><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M16 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" /></svg>,
  mute: <svg {...sv}><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" /></svg>,
  more: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="12" r="1.8" fill="currentColor" /><circle cx="12" cy="12" r="1.8" fill="currentColor" /><circle cx="18.5" cy="12" r="1.8" fill="currentColor" /></svg>,
  note: <svg {...sv}><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>,
  film: <svg {...sv}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></svg>,
  folder: <svg {...sv}><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>,
  share: <svg {...sv}><path d="M12 3v12M7.5 7.5L12 3l4.5 4.5M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></svg>,
  drag: <svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" /><circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" /></g></svg>,
  squad: <svg {...sv}><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4.5-6.5" /></svg>,
};
const tap = () => { if (GOS) haptic("press"); };
/** A colour for a file with no picture, from its id (the same file always the same colour). */
const hue = (id: string) => (parseInt(id.slice(0, 6), 16) % 360);
const REC = "\u0000rec";   // the "Recordings" tab (screen recordings, PS 1.60 pull request 12c; not a real folder name either)
const SQUAD = "\u0000squad";   // the "From your squad" tab (not a real folder name: no folder can hold \u0000)

type Menu = { x: number; y: number; item: MediaItem | null };
type Sheet = { kind: "time"; item: MediaItem } | { kind: "settings" } | { kind: "share"; item: MediaItem } | { kind: "rename"; item: MediaItem } | { kind: "remove"; items: MediaItem[] };

export function Soundboard({ onClose }: { onClose: () => void }) {
  const sb = useSb();
  const p = usePlayer();
  const { prefs, lib } = sb;
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [queueOpen, setQueueOpen] = useState(() => !GOS && typeof window !== "undefined" && window.innerWidth >= 1100);
  const [full, setFull] = useState(false);
  const [dropHere, setDropHere] = useState(false);
  const view: View = full ? "full" : prefs.view;
  const folders = useMemo(() => foldersOf(lib.items), [lib.items]);
  const squadTab = prefs.folder === SQUAD;
  const rec = useRecItems();
  const recTab = prefs.folder === REC && rec.on;
  const shown = useMemo(() => squadTab || recTab ? [] : filterItems(lib.items, q, prefs.folder, prefs.kind), [lib.items, q, prefs.folder, prefs.kind, squadTab, recTab]);
  const cur = current(prefs.queue);
  const curItem = cur ? lib.items.find((i) => i.id === cur.media) ?? null : null;
  useEffect(() => { setOpen(true); prime(); return () => setOpen(false); }, []);
  useEffect(() => { applyVolume(); }, [prefs.vol, prefs.muted]);

  // Esc and the phone's back: one layer at a time.
  const back = useRef<() => boolean>(() => false);
  back.current = () => {
    if (menu) { setMenu(null); return true; }
    if (sheet) { setSheet(null); return true; }
    if (full) { setFull(false); return true; }
    // The queue is a layer only where it covers the screen (it sits beside the small preview on a wide window).
    if (queueOpen && (view !== "corner" || GOS || window.innerWidth < 721)) { setQueueOpen(false); return true; }
    onClose();
    return true;
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); back.current(); return; }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "BUTTON")) return;
      if (e.key === " " && !e.metaKey && !e.ctrlKey) { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowRight" && e.shiftKey) { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft" && e.shiftKey) { e.preventDefault(); go(-1); }
      else if (e.key === "ArrowRight") nudge(5);
      else if (e.key === "ArrowLeft") nudge(-5);
      else if (e.key === "f" && curItem?.kind === "video") setFull((v) => !v);
    };
    const gosBack = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); back.current(); };
    const w = window as Window & { __psDimxClose?: () => boolean };
    const old = () => back.current();
    window.addEventListener("keydown", key, true);
    window.addEventListener("gos-back", gosBack, { capture: true });
    w.__psDimxClose = old;
    return () => { window.removeEventListener("keydown", key, true); window.removeEventListener("gos-back", gosBack, { capture: true }); if (w.__psDimxClose === old) delete w.__psDimxClose; };
  }, [curItem?.kind]);

  // Right click anywhere (and a long press on the phone): the menu.
  const lp = useRef<{ t: number; x: number; y: number; item: MediaItem | null } | null>(null);
  const openMenu = (x: number, y: number, item: MediaItem | null) => { tap(); setMenu({ x, y, item }); };
  const onContext = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, .sb-menu, .sb-sheet")) return;
    e.preventDefault();
    if (lp.current?.t === -1) { lp.current = null; return; }   // the long press already opened it
    const id = t.closest<HTMLElement>("[data-media]")?.dataset.media;
    openMenu(e.clientX, e.clientY, id ? lib.items.find((i) => i.id === id) ?? null : null);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, button.sb-noprss, .sb-menu, .sb-sheet, .sb-player, .sb-queue")) return;
    const id = t.closest<HTMLElement>("[data-media]")?.dataset.media;
    const item = id ? lib.items.find((i) => i.id === id) ?? null : null;
    const x = e.clientX, y = e.clientY;
    const timer = window.setTimeout(() => { lp.current = { t: -1, x, y, item }; openMenu(x, y, item); }, 520);
    lp.current = { t: timer, x, y, item };
  };
  const onPointerMove = (e: React.PointerEvent) => { const l = lp.current; if (l && l.t > 0 && Math.hypot(e.clientX - l.x, e.clientY - l.y) > 10) { window.clearTimeout(l.t); lp.current = null; } };
  const onPointerUp = () => { const l = lp.current; if (l && l.t > 0) { window.clearTimeout(l.t); lp.current = null; } };

  // Files dropped on the website (the Mac takes drops itself and says so with sb.drag).
  const onDragOver = (e: React.DragEvent) => { if (WHERE !== "web" || !e.dataTransfer.types.includes("Files")) return; e.preventDefault(); setDropHere(true); };
  const onDrop = async (e: React.DragEvent) => {
    if (WHERE !== "web") return;
    e.preventDefault(); setDropHere(false);
    dropFiles(await droppedFiles(e.dataTransfer));
  };

  const pick = (it: MediaItem) => { tap(); play(it.id); };
  const plays = prefs.plays;
  return (
    <section className={`sb sb-v-${view}${curItem ? " sb-has" : ""}${queueOpen ? " sb-qopen" : ""}`} role="dialog" aria-modal="true" aria-label="Soundboard"
      onContextMenu={onContext} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onDragOver={onDragOver} onDragLeave={(e) => { if (e.currentTarget === e.target) setDropHere(false); }} onDrop={(e) => void onDrop(e)}>
      <div className="sb-morph" aria-hidden="true" />
      <div className="sb-body">
        <header className="sb-head">
          <div className="sb-title">
            <button type="button" className="sb-icon sb-x" onClick={() => { tap(); onClose(); }} aria-label="Close the Soundboard" title="Close (Esc)">{I.close}</button>
            <h2>Soundboard</h2>
            <span className="sb-count">{lib.items.length ? `${lib.items.length} file${lib.items.length === 1 ? "" : "s"}` : ""}</span>
          </div>
          <div className="sb-tools">
            <label className="sb-search">{I.search}<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your sounds and videos" aria-label="Search" /></label>
            <div className="sb-seg" role="group" aria-label="Show">
              {(["all", "audio", "video"] as KindFilter[]).map((k) => (
                <button key={k} type="button" className={prefs.kind === k ? "on" : ""} aria-pressed={prefs.kind === k} onClick={() => { tap(); setPrefs({ kind: k }); }}>{k === "all" ? "All" : k === "audio" ? "Audio" : "Video"}</button>
              ))}
            </div>
            <button type="button" className="sb-btn sb-add" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); openMenu(r.left, r.bottom + 6, null); }}>{I.plus}<span>Add</span></button>
            <button type="button" className="sb-icon" onClick={() => { tap(); setSheet({ kind: "settings" }); }} aria-label="Soundboard settings" title="Where files are kept">{I.gear}</button>
          </div>
        </header>
        <nav className="sb-folders" aria-label="Folders">
          <Chip on={!prefs.folder} onClick={() => setPrefs({ folder: "" })}>All files</Chip>
          {folders.map((f) => (
            <Chip key={f} on={prefs.folder === f} onClick={() => setPrefs({ folder: f })} title={f}>{I.folder}{f.split("/").pop()}</Chip>
          ))}
          {shareHere() && <Chip on={squadTab} onClick={() => { setPrefs({ folder: SQUAD }); sbOp({ op: "list" }); }}>{I.squad}Shared in your squad</Chip>}
          {rec.on && <Chip on={recTab} onClick={() => setPrefs({ folder: REC })}>{I.play}Recordings</Chip>}
          {!squadTab && !recTab && shown.length > 1 && <button type="button" className="sb-playall" onClick={() => { tap(); playAll(shown.map((i) => i.id)); }}>{I.play}Play all {shown.length}</button>}
        </nav>
        <div className="sb-side">
          <Player item={curItem} view={view} onView={(v) => { if (v === "full") setFull(true); else { setFull(false); setPrefs({ view: v }); } }}
            onQueue={() => setQueueOpen((o) => !o)} queueOpen={queueOpen} onTime={() => curItem && setSheet({ kind: "time", item: curItem })} plays={plays} />
          {queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} />}
        </div>
        <main className="sb-main">
          {squadTab ? <SquadShared /> : recTab ? <RecordingsPanel query={q} /> : !sb.ready ? <p className="sb-empty">Loading your files</p> : !lib.items.length ? (
            <div className="sb-empty sb-first">
              <div className="sb-first-ic">{I.note}</div>
              <h3>Your Soundboard is empty</h3>
              <p>{GOS ? "Hold anywhere" : "Right click anywhere"}, or use Add, to bring in audio and video files or a whole folder.{WHERE === "mac" ? " You can also drop files here." : ""}</p>
              <div className="sb-first-btns">
                <button type="button" className="sb-btn sb-primary" onClick={() => addFiles("files")}>Add files</button>
                <button type="button" className="sb-btn" onClick={() => addFiles("folder")}>Add a folder</button>
              </div>
              <p className="sb-small">Kept on this {WHERE === "phone" ? "phone" : WHERE === "mac" ? "Mac" : "browser"} only. Never uploaded.</p>
            </div>
          ) : !shown.length ? <p className="sb-empty">Nothing matches.</p> : (
            <Grid items={shown} playing={p.playing ? p.media : null} current={cur?.media ?? null} plays={plays} onPlay={pick} onMore={(it, x, y) => openMenu(x, y, it)}
              onQueue={(it) => { tap(); updQueue((x) => enqueue(x, [it.id])); say(`"${it.name}" is in the queue.`); }} />
          )}
        </main>
        {sb.busy && <div className="sb-busy" role="status"><span>{sb.busy.what === "move" ? "Moving" : "Adding"} {sb.busy.total ? `${sb.busy.done + 1} of ${sb.busy.total}` : ""}{sb.busy.name ? `: ${sb.busy.name}` : "..."}</span><i style={{ ["--p" as string]: sb.busy.total ? sb.busy.done / sb.busy.total : 0.1 }} /></div>}
        {sb.note && <div className={`sb-note${sb.note.bad ? " bad" : ""}`} role="status">{sb.note.text}</div>}
        {sb.needsGrant && <div className="sb-note"><span>Your Soundboard folder needs your OK again.</span><button type="button" className="sb-btn" onClick={() => grantAgain()}>Allow</button></div>}
        {(dropHere || sb.drag) && <div className="sb-drop" aria-hidden="true"><div>{I.plus}<b>Drop to add to your Soundboard</b><span>Audio and video files, or whole folders</span></div></div>}
        {sb.ring && <RingBar />}
      </div>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} onSheet={setSheet} />}
      {sheet && <SheetHost sheet={sheet} onClose={() => setSheet(null)} />}
    </section>
  );
}

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return <button type="button" className={`sb-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => { tap(); onClick(); }} title={title}>{children}</button>;
}

// ---------- the grid ----------
const PAGE = 120;
function Grid({ items, playing, current: curId, plays, onPlay, onMore, onQueue }: { items: MediaItem[]; playing: string | null; current: string | null; plays: TimedPlay[];
  onPlay: (it: MediaItem) => void; onMore: (it: MediaItem, x: number, y: number) => void; onQueue: (it: MediaItem) => void }) {
  const [n, setN] = useState(PAGE);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { setN(PAGE); }, [items]);
  useEffect(() => {
    const el = end.current;
    if (!el || n >= items.length) return;
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) setN((v) => v + PAGE); }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [n, items.length]);
  const timed = new Set(plays.filter((x) => x.on).map((x) => x.media));
  return (
    <div className="sb-grid">
      {items.slice(0, n).map((it) => <Tile key={it.id} it={it} playing={playing === it.id} current={curId === it.id} timed={timed.has(it.id)} onPlay={onPlay} onMore={onMore} onQueue={onQueue} />)}
      {n < items.length && <div ref={end} className="sb-more" aria-hidden="true" />}
    </div>
  );
}
function Tile({ it, playing, current: cur, timed, onPlay, onMore, onQueue }: { it: MediaItem; playing: boolean; current: boolean; timed: boolean;
  onPlay: (it: MediaItem) => void; onMore: (it: MediaItem, x: number, y: number) => void; onQueue: (it: MediaItem) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  const t = useThumb(it, seen);
  return (
    <div ref={ref} className={`sb-tile sb-${it.kind}${playing ? " playing" : ""}${cur ? " current" : ""}`} data-media={it.id} style={{ ["--h" as string]: hue(it.id) }}>
      <button type="button" className="sb-tile-main" onClick={() => onPlay(it)} aria-label={`Play ${it.name}`}>
        <span className="sb-art">
          {t?.pic ? <img src={t.pic} alt="" loading="lazy" draggable={false} /> : t?.wave ? (
            <span className="sb-wave">{t.wave.map((v, i) => <i key={i} style={{ height: `${Math.max(6, v * 100)}%` }} />)}</span>
          ) : <span className="sb-art-ic">{it.kind === "video" ? I.film : I.note}</span>}
          <span className="sb-kind">{it.kind === "video" ? I.film : I.note}</span>
          {t?.dur ? <span className="sb-dur">{clock(t.dur)}</span> : null}
          {timed && <span className="sb-timed" title="Plays at a time">{I.alarm}</span>}
          <span className="sb-go">{playing ? <span className="sb-eq"><i /><i /><i /></span> : I.play}</span>
        </span>
        <span className="sb-name">{it.name}</span>
        <span className="sb-meta">{it.folder ? it.folder.split("/").pop() : it.ext.toUpperCase()} · {sizeWords(it.size)}</span>
      </button>
      <button type="button" className="sb-tile-q sb-noprss" onClick={() => onQueue(it)} aria-label={`Add ${it.name} to the queue`} title="Add to queue">{I.queue}</button>
      <button type="button" className="sb-tile-more sb-noprss" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onMore(it, r.right - 8, r.bottom + 4); }} aria-label={`More for ${it.name}`} title="More">{I.more}</button>
    </div>
  );
}

// ---------- the player ----------
function Player({ item, view, onView, onQueue, queueOpen, onTime, plays }: { item: MediaItem | null; view: View; onView: (v: View) => void; onQueue: () => void; queueOpen: boolean; onTime: () => void; plays: TimedPlay[] }) {
  const p = usePlayer();
  const sb = useSb();
  const box = useRef<HTMLDivElement>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  useEffect(() => (box.current ? mount(box.current) : undefined), []);
  const { prefs } = sb;
  const qn = prefs.queue.items.length;
  const timed = item ? plays.filter((x) => x.media === item.id && x.on) : [];
  // Full screen hides the controls after 2.5 s without a move (a film should fill the screen).
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (view !== "full") { setIdle(false); return; }
    let t = window.setTimeout(() => setIdle(true), 2500);
    const wake = () => { setIdle(false); window.clearTimeout(t); t = window.setTimeout(() => setIdle(true), 2500); };
    window.addEventListener("pointermove", wake); window.addEventListener("pointerdown", wake);
    return () => { window.clearTimeout(t); window.removeEventListener("pointermove", wake); window.removeEventListener("pointerdown", wake); };
  }, [view]);
  const time = scrub ?? p.time;
  return (
    <div className={`sb-player sb-p-${item?.kind ?? "none"}${idle ? " idle" : ""}`} aria-label="Player" hidden={!item}>
      <div className="sb-screen" onClick={() => toggle()} onDoubleClick={() => item?.kind === "video" && onView(view === "full" ? "wide" : "full")}>
        <div ref={box} className="sb-box" />
        {item?.kind === "audio" && <AudioFace item={item} playing={p.playing} />}
        {p.loading && <span className="sb-spin" aria-hidden="true" />}
      </div>
      <div className="sb-ctl">
        <div className="sb-now">
          <b title={item?.name}>{item?.name ?? ""}</b>
          <span>{item?.folder ? item.folder : item ? item.ext.toUpperCase() : ""}{timed.length ? ` · plays at ${timedWords(timed)}` : ""}</span>
        </div>
        <div className="sb-seek">
          <span>{clock(time)}</span>
          <input type="range" min={0} max={Math.max(1, p.dur)} step={0.1} value={Math.min(time, p.dur || time)} aria-label="Seek"
            onChange={(e) => setScrub(Number(e.target.value))} onPointerUp={() => { if (scrub !== null) { seek(scrub); setScrub(null); } }}
            onKeyUp={() => { if (scrub !== null) { seek(scrub); setScrub(null); } }} style={{ ["--p" as string]: p.dur ? Math.min(1, time / p.dur) : 0 }} />
          <span>{clock(p.dur)}</span>
        </div>
        <div className="sb-keys">
          <button type="button" className={`sb-icon sb-sm${prefs.queue.shuffle ? " on" : ""}`} onClick={() => { tap(); updQueue((x) => setShuffle(x, !x.shuffle)); }} aria-pressed={prefs.queue.shuffle} aria-label="Shuffle" title="Shuffle">{I.shuffle}</button>
          <button type="button" className="sb-icon" onClick={() => { tap(); go(-1); }} aria-label="Previous" title="Previous (Shift Left)">{I.prev}</button>
          <button type="button" className="sb-icon sb-big" onClick={() => { tap(); toggle(); }} aria-label={p.playing ? "Pause" : "Play"} title="Play or pause (Space)">{p.playing ? I.pause : I.play}</button>
          <button type="button" className="sb-icon" onClick={() => { tap(); go(1); }} aria-label="Next" title="Next (Shift Right)">{I.next}</button>
          <button type="button" className="sb-icon sb-expand" onClick={() => { tap(); onView("wide"); }} aria-label="Open the big player" title="Big player">{I.wide}</button>
          <button type="button" className={`sb-icon sb-sm${prefs.queue.repeat !== "off" ? " on" : ""}`} onClick={() => { tap(); updQueue((x) => ({ ...x, repeat: nextRepeat(x.repeat) })); }}
            aria-label={`Repeat: ${prefs.queue.repeat === "off" ? "off" : prefs.queue.repeat === "all" ? "all" : "this one"}`} title="Repeat">{I.repeat}{prefs.queue.repeat === "one" && <em>1</em>}</button>
        </div>
        <div className="sb-row2">
          <label className="sb-vol">
            <button type="button" className="sb-icon sb-sm" onClick={() => setPrefs({ muted: !prefs.muted })} aria-label={prefs.muted ? "Unmute" : "Mute"}>{prefs.muted || prefs.vol === 0 ? I.mute : I.vol}</button>
            <input type="range" min={0} max={1} step={0.02} value={prefs.muted ? 0 : prefs.vol} aria-label="Volume" onChange={(e) => setPrefs({ vol: Number(e.target.value), muted: false })}
              style={{ ["--p" as string]: prefs.muted ? 0 : prefs.vol }} />
          </label>
          <button type="button" className={`sb-icon sb-sm${queueOpen ? " on" : ""}`} onClick={() => { tap(); onQueue(); }} aria-pressed={queueOpen} aria-label={`Queue, ${qn}`} title="Queue">{I.queue}{qn > 1 && <em>{qn}</em>}</button>
          <button type="button" className={`sb-icon sb-sm${timed.length ? " on" : ""}`} onClick={() => { tap(); onTime(); }} aria-label="Play at a time" title="Play at a time">{I.alarm}</button>
          <span className="sb-views" role="group" aria-label="Player size">
            <button type="button" className={`sb-icon sb-sm${view === "corner" ? " on" : ""}`} onClick={() => { tap(); onView("corner"); }} aria-label="Small, top right" title="Small, top right">{I.corner}</button>
            <button type="button" className={`sb-icon sb-sm${view === "wide" ? " on" : ""}`} onClick={() => { tap(); onView("wide"); }} aria-label="Large, top middle" title="Large, top middle">{I.wide}</button>
            <button type="button" className={`sb-icon sb-sm${view === "full" ? " on" : ""}`} onClick={() => { tap(); onView(view === "full" ? "wide" : "full"); }} aria-label={view === "full" ? "Leave full screen" : "Full screen"} title="Full screen (F)">{view === "full" ? I.exitFull : I.full}</button>
          </span>
          <button type="button" className="sb-icon sb-sm" onClick={() => { tap(); stop(); updQueue((x) => ({ ...x, at: -1 })); }} aria-label="Close the player" title="Stop and close the player">{I.close}</button>
        </div>
      </div>
    </div>
  );
}
function AudioFace({ item, playing }: { item: MediaItem; playing: boolean }) {
  const t = useThumb(item, true);
  return (
    <div className={`sb-face${playing ? " on" : ""}`} style={{ ["--h" as string]: hue(item.id) }} aria-hidden="true">
      {t?.wave ? <span className="sb-wave">{t.wave.map((v, i) => <i key={i} style={{ height: `${Math.max(6, v * 100)}%` }} />)}</span> : <span className="sb-art-ic">{I.note}</span>}
    </div>
  );
}
const timedWords = (list: TimedPlay[]) => list.map((x) => timeWords(x.at)).join(", ");

// ---------- the queue ----------
function QueuePanel({ onClose }: { onClose: () => void }) {
  const { prefs, lib } = useSb();
  const q = prefs.queue;
  const byId = new Map(lib.items.map((i) => [i.id, i]));
  const cur = current(q);
  const next = upNext(q);
  const list = useRef<HTMLOListElement>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  // Drag a row by its handle: the row under the pointer is where it goes (mouse and finger alike).
  const startDrag = (e: React.PointerEvent, key: string) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragKey(key);
    tap();
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (!dragKey || !list.current) return;
    const rows = [...list.current.querySelectorAll<HTMLElement>("[data-key]")];
    const over = rows.find((r) => { const b = r.getBoundingClientRect(); return e.clientY >= b.top && e.clientY < b.bottom; });
    if (!over || over.dataset.key === dragKey) return;
    const to = q.items.findIndex((x) => x.key === over.dataset.key);
    if (to >= 0) updQueue((x) => moveTo(x, dragKey, to));
  };
  const rows = q.shuffle ? next : q.items.slice(q.at + 1);
  return (
    <aside className="sb-queue" aria-label="Queue">
      <header>
        <b>Queue</b>
        <button type="button" className="sb-btn sb-sm" onClick={() => updQueue(clearQueue)} disabled={q.items.length <= 1}>Clear</button>
        <button type="button" className="sb-icon sb-sm" onClick={onClose} aria-label="Close the queue">{I.close}</button>
      </header>
      {cur && <p className="sb-q-h">Now playing</p>}
      {cur && <QRow it={byId.get(cur.media)} k={cur.key} now />}
      <p className="sb-q-h">{q.shuffle ? "Up next (shuffled)" : "Up next"}</p>
      {!rows.length ? <p className="sb-q-empty">Add files with the queue button on a tile, or Play next in a file's menu.</p> : (
        <ol ref={list} onPointerMove={moveDrag} onPointerUp={() => setDragKey(null)} onPointerCancel={() => setDragKey(null)}>
          {rows.map((e) => (
            <li key={e.key} data-key={e.key} className={dragKey === e.key ? "drag" : ""}>
              {!q.shuffle && <span className="sb-q-drag" onPointerDown={(ev) => startDrag(ev, e.key)} aria-label="Drag to move" role="button" tabIndex={-1}>{I.drag}</span>}
              <QRow it={byId.get(e.media)} k={e.key} />
            </li>
          ))}
        </ol>
      )}
      {q.at > 0 && !q.shuffle && <p className="sb-q-h sb-q-done">Played: {q.at}</p>}
    </aside>
  );
}
function QRow({ it, k, now }: { it?: MediaItem; k: string; now?: boolean }) {
  if (!it) return null;
  return (
    <div className={`sb-q-row${now ? " now" : ""}`} style={{ ["--h" as string]: hue(it.id) }}>
      <button type="button" className="sb-q-play" onClick={() => { tap(); jump(useSbState().prefs.queue.items.findIndex((x) => x.key === k)); }} aria-label={`Play ${it.name}`}>
        <span className="sb-q-ic">{it.kind === "video" ? I.film : I.note}</span><span className="sb-q-n">{it.name}</span>
      </button>
      {!now && <button type="button" className="sb-icon sb-sm" onClick={() => updQueue((x) => removeAt(x, k))} aria-label={`Take ${it.name} out of the queue`}>{I.close}</button>}
    </div>
  );
}

// ---------- menus ----------
function ContextMenu({ menu, onClose, onSheet }: { menu: Menu; onClose: () => void; onSheet: (s: Sheet) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8)) });
  }, [menu.x, menu.y]);
  const { prefs } = useSb();
  const it = menu.item;
  const act = (f: () => void) => () => { tap(); onClose(); f(); };
  const items: { label: string; icon: ReactNode; run: () => void; bad?: boolean; off?: boolean }[] = it ? [
    { label: "Play now", icon: I.play, run: () => play(it.id) },
    { label: "Play next", icon: I.next, run: () => { updQueue((x) => playNext(x, it.id)); say(`"${it.name}" plays next.`); } },
    { label: "Add to queue", icon: I.queue, run: () => { updQueue((x) => enqueue(x, [it.id])); say(`"${it.name}" is in the queue.`); } },
    { label: "Play at a time", icon: I.alarm, run: () => onSheet({ kind: "time", item: it }) },
    ...(it.kind === "audio" ? [{ label: "Use as my alarm sound", icon: I.alarm, run: () => void useAsAlarm(it) }] : []),
    ...(shareHere() ? [{ label: "Share in the G Squad", icon: I.share, run: () => onSheet({ kind: "share", item: it }) }] : []),
    { label: "Rename", icon: I.note, run: () => onSheet({ kind: "rename", item: it }) },
    { label: "Remove from the Soundboard", icon: I.close, run: () => onSheet({ kind: "remove", items: [it] }), bad: true },
  ] : [
    { label: "Add audio or video files", icon: I.plus, run: () => addFiles("files") },
    { label: "Add a folder", icon: I.folder, run: () => addFiles("folder") },
    { label: "Where files are kept", icon: I.gear, run: () => onSheet({ kind: "settings" }) },
  ];
  return (
    <div className="sb-menu-dim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div ref={ref} className="sb-menu" role="menu" style={{ left: pos.x, top: pos.y }}>
        {it && <p className="sb-menu-h">{it.name}</p>}
        {items.map((x) => (
          <button key={x.label} type="button" role="menuitem" className={`sb-menu-i${x.bad ? " bad" : ""}`} onClick={act(x.run)} disabled={x.off}>{x.icon}<span>{x.label}</span></button>
        ))}
      </div>
    </div>
  );
}

// ---------- sheets ----------
function SheetHost({ sheet, onClose }: { sheet: Sheet; onClose: () => void }) {
  return (
    <div className="sb-sheet-dim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sb-sheet" role="dialog" aria-modal="true">
        {sheet.kind === "time" && <TimeSheet item={sheet.item} onClose={onClose} />}
        {sheet.kind === "settings" && <SettingsSheet onClose={onClose} />}
        {sheet.kind === "share" && <ShareSheet item={sheet.item} onClose={onClose} />}
        {sheet.kind === "rename" && <RenameSheet item={sheet.item} onClose={onClose} />}
        {sheet.kind === "remove" && <RemoveSheet items={sheet.items} onClose={onClose} />}
      </div>
    </div>
  );
}
function SheetHead({ title, onClose }: { title: string; onClose: () => void }) {
  return <header className="sb-sheet-h"><h3>{title}</h3><button type="button" className="sb-icon sb-sm" onClick={onClose} aria-label="Close">{I.close}</button></header>;
}
const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };
const WHERE_WORDS = WHERE === "mac" ? "Plays on this Mac at your alarm volume, even with the Soundboard closed. Stop or Esc ends it."
  : WHERE === "phone" ? "Plays on this phone like an alarm, even with PS app closed. Stop on the notification ends it."
  : "Plays while this page is open in the browser. PS app on the Mac or the phone can play it with PS app closed.";

function TimeSheet({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const { prefs } = useSb();
  const mine = prefs.plays.filter((x) => x.media === item.id);
  const [text, setText] = useState("7:07am");
  const [days, setDays] = useState<number[]>(ALL_DAYS);
  const [loop, setLoop] = useState(false);
  const [vol, setVol] = useState(VOL_DEF);
  const at = parseTime(text);
  const save = () => {
    if (!at || !days.length) return;
    const p: TimedPlay = { id: Math.random().toString(36).slice(2, 10), media: item.id, name: item.name, at, days, vol, loop, on: true };
    setPrefs({ plays: [...prefs.plays, p].slice(-50) });
    const when = nextFire(p, Date.now(), deviceTz());
    say(`"${item.name}" plays at ${timeWords(at)}, ${daysWords(days).toLowerCase()}.${when > 0 ? ` Next: ${new Date(when).toLocaleDateString(undefined, { weekday: "long" })}.` : ""}`);
    onClose();
  };
  const patch = (id: string, v: Partial<TimedPlay>) => setPrefs({ plays: prefs.plays.map((x) => (x.id === id ? { ...x, ...v } : x)) });
  return (
    <>
      <SheetHead title="Play at a time" onClose={onClose} />
      <p className="sb-sheet-sub">{item.name}</p>
      <label className="sb-field"><span>Time</span>
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} placeholder="7:07am" inputMode="text" aria-invalid={!at} />
        <em>{at ? timeWords(at) : "Type a time like 7:07am or 19:30"}</em>
      </label>
      <div className="sb-field"><span>Days</span>
        <div className="sb-days">{DAY_LETTERS.map((l, d) => (
          <button key={d} type="button" className={days.includes(d) ? "on" : ""} aria-pressed={days.includes(d)} onClick={() => { tap(); setDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d].sort())); }}>{l}</button>
        ))}</div>
        <em>{days.length ? daysWords(days) : "Pick at least one day"}</em>
      </div>
      <div className="sb-field"><span>How</span>
        <div className="sb-seg">
          <button type="button" className={!loop ? "on" : ""} onClick={() => setLoop(false)}>Play it once</button>
          <button type="button" className={loop ? "on" : ""} onClick={() => setLoop(true)}>Loop until I stop it</button>
        </div>
        <em>{loop ? `Stops by itself after ${LOOP_MAX_MS / 60000} minutes.` : "Plays to the end of the file."}</em>
      </div>
      <label className="sb-field"><span>Loudness</span>
        <input type="range" min={0.1} max={1} step={0.05} value={vol} onChange={(e) => setVol(Number(e.target.value))} style={{ ["--p" as string]: (vol - 0.1) / 0.9 }} />
        <em>{Math.round(vol * 100)}% {WHERE === "web" ? "of the browser's volume" : "of the device's volume while it plays"}</em>
      </label>
      <p className="sb-sheet-note">{WHERE_WORDS} Do Not Disturb is respected the same way as your alarms.</p>
      <div className="sb-sheet-btns">
        {item.kind === "audio" && <button type="button" className="sb-btn" onClick={() => { void useAsAlarm(item); onClose(); }}>Use as my alarm sound</button>}
        <button type="button" className="sb-btn sb-primary" onClick={save} disabled={!at || !days.length}>Save</button>
      </div>
      {!!mine.length && <>
        <p className="sb-q-h">Already set for this file</p>
        <ul className="sb-plays">{mine.map((x) => (
          <li key={x.id}>
            <label className="sb-switch"><input type="checkbox" checked={x.on} onChange={(e) => patch(x.id, { on: e.target.checked })} /><i /></label>
            <span><b>{timeWords(x.at)}</b> {daysWords(x.days)}{x.loop ? ", loop" : ""}</span>
            <button type="button" className="sb-icon sb-sm" onClick={() => setPrefs({ plays: prefs.plays.filter((y) => y.id !== x.id) })} aria-label={`Delete ${timeWords(x.at)}`}>{I.close}</button>
          </li>
        ))}</ul>
      </>}
    </>
  );
}

function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { lib, prefs, busy } = useSb();
  const total = lib.items.reduce((a, i) => a + i.size, 0);
  const byMedia = new Map(lib.items.map((i) => [i.id, i]));
  return (
    <>
      <SheetHead title="Soundboard" onClose={onClose} />
      <div className="sb-field"><span>Files are kept in</span>
        <p className="sb-loc">{I.folder}<b>{lib.loc.label || "This device"}</b></p>
        <em>{lib.items.length} file{lib.items.length === 1 ? "" : "s"}, {sizeWords(total)}. On this {WHERE === "phone" ? "phone" : WHERE === "mac" ? "Mac" : "browser"} only, never uploaded to your vault.</em>
        <div className="sb-sheet-btns sb-left">
          {canChooseFolder() && <button type="button" className="sb-btn" disabled={!!busy} onClick={() => chooseLocation("choose")}>Choose another folder</button>}
          {lib.loc.custom && <button type="button" className="sb-btn" disabled={!!busy} onClick={() => chooseLocation("default")}>Back to the default</button>}
        </div>
        <em>Moving copies every file to the new place, checks each one, and only then removes PS app's old copies. Files already in a folder you pick join the Soundboard, and PS app never deletes them.</em>
      </div>
      <label className="sb-field sb-row"><span>Keep playing when the Soundboard is closed</span>
        <span className="sb-switch"><input type="checkbox" checked={prefs.keep} onChange={(e) => setPrefs({ keep: e.target.checked })} /><i /></span>
      </label>
      <p className="sb-sheet-note">Off: closing the Soundboard stops what is playing.</p>
      {!!prefs.plays.length && <>
        <p className="sb-q-h">Timed plays on this {WHERE === "phone" ? "phone" : WHERE === "mac" ? "Mac" : "browser"}</p>
        <ul className="sb-plays">{prefs.plays.map((x) => (
          <li key={x.id} className={byMedia.has(x.media) ? "" : "gone"}>
            <label className="sb-switch"><input type="checkbox" checked={x.on} onChange={(e) => setPrefs({ plays: prefs.plays.map((y) => (y.id === x.id ? { ...y, on: e.target.checked } : y)) })} /><i /></label>
            <span><b>{timeWords(x.at)}</b> {x.name} · {daysWords(x.days)}{byMedia.has(x.media) ? "" : " (file gone)"}</span>
            <button type="button" className="sb-icon sb-sm" onClick={() => setPrefs({ plays: prefs.plays.filter((y) => y.id !== x.id) })} aria-label="Delete">{I.close}</button>
          </li>
        ))}</ul>
      </>}
    </>
  );
}

function ShareSheet({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const sq = useSquad();
  const v = useSbShare();
  const [note, setNote] = useState("");
  const ok = canShare(item);
  useEffect(() => () => clearShareNote(), []);
  if (!sq.in) return (<><SheetHead title="Share in the G Squad" onClose={onClose} /><p className="sb-sheet-note">Join or make a squad first, with the G Squad button.</p></>);
  return (
    <>
      <SheetHead title="Share in the G Squad" onClose={onClose} />
      <p className="sb-sheet-sub">{item.name} · {sizeWords(item.size)}</p>
      <label className="sb-field"><span>A note (optional)</span>
        <input value={note} maxLength={SHARE_NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder="Play this before a heavy set" />
      </label>
      {ok.ok ? <p className="sb-sheet-note">The sound is sealed with your squad's key on this device, so only your squad can open it. It stays on the squad hub for 14 days. Up to 10 MB a file, 15 files per squad at a time.</p>
        : <p className="sb-sheet-note bad">{ok.why}</p>}
      {v.busy && <p className="sb-sheet-note" role="status">{v.busy}</p>}
      {v.note && <p className={`sb-sheet-note${v.note.bad ? " bad" : ""}`} role="status">{v.note.text}</p>}
      <div className="sb-sheet-btns">
        <button type="button" className="sb-btn" disabled={!!v.busy} onClick={() => { sbOp({ op: "name", name: item.name, note }); }}>Share the name and note only</button>
        {ok.ok && <button type="button" className="sb-btn sb-primary" disabled={!!v.busy} onClick={() => sbOp({ op: "share", id: item.id, name: item.name, ext: item.ext, size: item.size, note })}>Share the sound</button>}
      </div>
    </>
  );
}
function SquadShared() {
  const v = useSbShare();
  const sq = useSquad();
  if (!sq.in) return <p className="sb-empty">Join or make a squad with the G Squad button to share sounds.</p>;
  return (
    <div className="sb-squad">
      <p className="sb-sheet-note">Sounds your squad shared in the last 14 days. Save one to keep it in your own Soundboard.</p>
      {v.busy && <p className="sb-sheet-note" role="status">{v.busy}</p>}
      {v.note && <p className={`sb-sheet-note${v.note.bad ? " bad" : ""}`} role="status">{v.note.text}</p>}
      {v.loaded && !v.files.length && <p className="sb-empty">Nothing shared yet. Share one from a file's menu.</p>}
      <ul className="sb-shared">{v.files.map((f) => (
        <li key={f.id} style={{ ["--h" as string]: hue(f.id.replace(/-/g, "")) }}>
          <span className="sb-q-ic">{I.note}</span>
          <span className="sb-shared-t"><b>{f.name}</b><em>{f.by} · {sizeWords(f.size)}{f.note ? ` · ${f.note}` : ""}</em></span>
          {f.mine ? <button type="button" className="sb-btn sb-sm" disabled={!!v.busy} onClick={() => sbOp({ op: "del", file: f.id })}>Take off</button>
            : <button type="button" className="sb-btn sb-sm sb-primary" disabled={!!v.busy || v.saved.includes(f.id)} onClick={() => sbOp({ op: "fetch", file: f.id })}>{v.saved.includes(f.id) ? "Saved" : "Save"}</button>}
        </li>
      ))}</ul>
    </div>
  );
}
function RenameSheet({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const [name, setName] = useState(item.name);
  const save = () => { if (name.trim()) { renameItem(item.id, name); onClose(); } };
  return (
    <>
      <SheetHead title="Rename" onClose={onClose} />
      <label className="sb-field"><span>Name</span><input autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} /></label>
      <p className="sb-sheet-note">Only the name in the Soundboard changes; the file keeps its own.</p>
      <div className="sb-sheet-btns"><button type="button" className="sb-btn sb-primary" onClick={save} disabled={!name.trim()}>Save</button></div>
    </>
  );
}
function RemoveSheet({ items, onClose }: { items: MediaItem[]; onClose: () => void }) {
  const { prefs } = useSb();
  const ids = items.map((i) => i.id);
  const timed = prefs.plays.filter((x) => ids.includes(x.media)).length;
  return (
    <>
      <SheetHead title={items.length === 1 ? `Remove "${items[0].name}"?` : `Remove ${items.length} files?`} onClose={onClose} />
      <p className="sb-sheet-note">The Soundboard's copy is deleted from this device. The file you added it from is not touched, and a file you put in the folder yourself is only hidden.{timed ? ` Its ${timed} timed play${timed === 1 ? "" : "s"} go too.` : ""}</p>
      <div className="sb-sheet-btns">
        <button type="button" className="sb-btn" onClick={onClose}>Keep</button>
        <button type="button" className="sb-btn sb-bad" onClick={() => {
          if (ids.includes(current(prefs.queue)?.media ?? "")) stop();
          setPrefs({ plays: prefs.plays.filter((x) => !ids.includes(x.media)) });
          removeItems(ids); onClose();
        }}>Remove</button>
      </div>
    </>
  );
}

/** The bar while a timed play rings: its name and Stop (also inside the Soundboard). */
export function RingBar() {
  const { ring } = useSb();
  if (!ring) return null;
  return (
    <div className="sb-ring" role="alert">
      <span className="sb-ring-ic">{I.alarm}</span>
      <span className="sb-ring-t"><b>{ring.name || "A timed play"}</b><em>is playing</em></span>
      <button type="button" className="sb-btn sb-primary" onClick={() => { tap(); stopRing(); }}>Stop</button>
    </div>
  );
}

// Every file in a drop, folders included (the website).
async function droppedFiles(dt: DataTransfer): Promise<{ file: File; path: string }[]> {
  const out: { file: File; path: string }[] = [];
  type Entry = { isFile: boolean; isDirectory: boolean; name: string; file?: (ok: (f: File) => void, bad: () => void) => void; createReader?: () => { readEntries: (ok: (e: Entry[]) => void, bad: () => void) => void } };
  const walk = async (e: Entry, path: string, depth: number): Promise<void> => {
    if (e.isFile && e.file) { const f = await new Promise<File | null>((res) => e.file!(res, () => res(null))); if (f) out.push({ file: f, path: `${path}${e.name}` }); return; }
    if (e.isDirectory && e.createReader && depth < 5) {
      const r = e.createReader();
      for (;;) {
        const batch = await new Promise<Entry[]>((res) => r.readEntries(res, () => res([])));
        if (!batch.length) break;
        for (const x of batch) await walk(x, `${path}${e.name}/`, depth + 1);
      }
    }
  };
  const entries = [...dt.items].map((i) => (i as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.() ?? null);
  if (entries.some(Boolean)) { for (const e of entries) if (e) await walk(e, "", 0); }
  else for (const f of [...dt.files]) out.push({ file: f, path: f.name });
  return out;
}
