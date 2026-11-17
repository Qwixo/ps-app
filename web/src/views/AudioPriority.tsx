// Audio priority (PS 1.65, feature "audio-priority"): the volume mixer's two ordered lists, Speakers and Microphones
// (core/audiopriority.ts holds the rules and the words, ps-mac Sources/AudioPriority.swift does the switching).
// Grab a row and drag it: the other rows glide out of the way on springs, the row settles into its place with a soft
// sound, and the new order goes to the Mac at once. A click on a connected row uses it now. A remembered row that is
// not connected shows dimmed with a Forget button. Reduced motion: no springs and no lift, rows just move.
// Never takes focus (pointer down is kept from focusing anything), Esc closes the mixer as before (views/Mixer.tsx).
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { psPost } from "../ps";
import { sfx } from "../ui/sfx";
import { AP_SIDES, AP_WORDS, cleanAPState, dropIndex, isDrag, moveItem, noteFor, orderOf, shiftFor, springAtRest, springStep,
  type APKind, type APRow, type APSide, type APState, type Spring } from "../core/audiopriority";
import "./audiopriority.css";

let state: APState | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  (window as Window & { __psAudioPrio?: unknown }).__psAudioPrio = (m: unknown) => {
    const s = cleanAPState(m);
    if (!s) return;
    state = s;
    listeners.forEach((l) => l());
  };
}
const send = (m: Record<string, unknown>) => psPost({ type: "audioprio", ...m });
export const useAudioPrio = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state);
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const P = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
function KindIcon({ kind, side, name }: { kind: APKind; side: APSide; name: string }) {
  const n = name.toLowerCase();
  if (/airpods|headphone|buds|beats|headset/.test(n) || kind === "jack" && side === "speakers")
    return <svg {...P}><path d="M4 15v-3a8 8 0 0 1 16 0v3" /><rect x="3" y="14" width="4.5" height="6.5" rx="1.6" /><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.6" /></svg>;
  if (kind === "builtIn") return <svg {...P}><rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M2 19h20" /></svg>;
  if (kind === "display") return <svg {...P}><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M9 20h6M12 16v4" /></svg>;
  if (kind === "airplay") return <svg {...P}><path d="M6 17H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-2" /><path d="M12 15l5 6H7z" /></svg>;
  if (kind === "phone") return <svg {...P}><rect x="7" y="2.5" width="10" height="19" rx="2.2" /><path d="M11 18.5h2" /></svg>;
  if (side === "mics") return <svg {...P}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>;
  if (kind === "bluetooth") return <svg {...P}><path d="M7 7l10 10-5 4V3l5 4L7 17" /></svg>;
  return <svg {...P}><path d="M11 5L6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /></svg>;
}

type Drag = { uid: string; from: number; x0: number; y0: number; dy: number; over: number; pitch: number; active: boolean; pid: number };

function DeviceList({ side, rows, note }: { side: APSide; rows: APRow[]; note: string }) {
  const [local, setLocal] = useState<{ ids: string[]; at: number } | null>(null);   // our new order, until the Mac says it back
  const [leaving, setLeaving] = useState<string | null>(null);
  const [dragUid, setDragUid] = useState<string | null>(null);
  const els = useRef(new Map<string, HTMLDivElement>());
  const springs = useRef(new Map<string, Spring>());
  const targets = useRef(new Map<string, number>());
  const drag = useRef<Drag | null>(null);
  const raf = useRef(0);
  const last = useRef(0);
  const settleDone = useRef<(() => void) | null>(null);

  // The rows in the order to draw: ours right after a drop (the Mac's answer follows in a moment), else the Mac's.
  let order = rows;
  if (local) {
    const byId = new Map(rows.map((r) => [r.uid, r]));
    const mine = local.ids.map((u) => byId.get(u)).filter((r): r is APRow => !!r);
    order = [...mine, ...rows.filter((r) => !local.ids.includes(r.uid))];
  }
  useEffect(() => {
    if (!local) return;
    if (orderOf(rows).join("\n") === local.ids.join("\n")) { setLocal(null); return; }
    const t = window.setTimeout(() => setLocal(null), 2000);          // the Mac never said it back: its order wins
    return () => window.clearTimeout(t);
  }, [rows, local]);

  // After the order changed in the DOM, every row is drawn where it now is: transforms back to zero, no jump.
  useLayoutEffect(() => {
    if (drag.current) return;
    for (const [u, el] of els.current) { el.style.transform = ""; springs.current.set(u, { x: 0, v: 0 }); targets.current.set(u, 0); }
  }, [order.map((r) => r.uid).join("\n")]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const paint = (u: string, x: number) => {
    const el = els.current.get(u);
    if (!el) return;
    el.style.transform = x ? `translateY(${x}px)` : "";                  // the lift itself is CSS (scale, .lifted)
  };
  const loop = (t: number) => {
    const dt = last.current ? (t - last.current) / 1000 : 1 / 60;
    last.current = t;
    let moving = false;
    for (const [u] of els.current) {
      const d = drag.current;
      if (d?.active && d.uid === u) { paint(u, d.dy); continue; }        // the grabbed row follows the pointer exactly
      const to = targets.current.get(u) ?? 0;
      const s = springs.current.get(u) ?? { x: 0, v: 0 };
      const n = springStep(s, to, dt);
      const rest = springAtRest(n, to);
      springs.current.set(u, rest ? { x: to, v: 0 } : n);
      paint(u, rest ? to : n.x);
      if (!rest) moving = true;
    }
    if (moving || drag.current?.active) raf.current = requestAnimationFrame(loop);
    else { raf.current = 0; last.current = 0; const f = settleDone.current; settleDone.current = null; f?.(); }
  };
  const kick = () => { if (!raf.current) { last.current = 0; raf.current = requestAnimationFrame(loop); } };
  const setTargets = (from: number, over: number, pitch: number) => {
    order.forEach((r, i) => targets.current.set(r.uid, shiftFor(i, from, over) * pitch));
    if (reducedMotion()) order.forEach((r) => { if (r.uid !== drag.current?.uid) { const to = targets.current.get(r.uid) ?? 0; springs.current.set(r.uid, { x: to, v: 0 }); paint(r.uid, to); } });
    else kick();
  };

  const down = (e: React.PointerEvent<HTMLDivElement>, i: number, r: APRow) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".ap-x")) return;
    e.preventDefault();                                                    // never takes focus
    const el = els.current.get(r.uid);
    const next = order[i + 1] && els.current.get(order[i + 1].uid), prev = order[i - 1] && els.current.get(order[i - 1].uid);
    const pitch = next && el ? next.offsetTop - el.offsetTop : prev && el ? el.offsetTop - prev.offsetTop : (el?.offsetHeight ?? 34) + 4;
    drag.current = { uid: r.uid, from: i, x0: e.clientX, y0: e.clientY, dy: 0, over: i, pitch, active: false, pid: e.pointerId };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pid !== e.pointerId) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.active) {
      if (!isDrag(dx, dy) || order.length < 2) return;
      d.active = true;
      setDragUid(d.uid);
      sfx.ap("lift");
    }
    // A little resistance past the ends of the list, like a native list.
    const minY = -d.from * d.pitch, maxY = (order.length - 1 - d.from) * d.pitch;
    d.dy = dy < minY ? minY + (dy - minY) * 0.25 : dy > maxY ? maxY + (dy - maxY) * 0.25 : dy;
    const over = dropIndex(d.from, d.dy, d.pitch, order.length);
    if (over !== d.over) { d.over = over; sfx.ap("slot"); setTargets(d.from, over, d.pitch); }
    if (reducedMotion()) paint(d.uid, d.dy); else kick();
  };
  const finish = (cancel: boolean) => {
    const d = drag.current;
    if (!d) return;
    if (!d.active) {
      drag.current = null;
      const r = order[d.from];
      if (!cancel && r?.connected && !r.using) { sfx.ap("use"); send({ op: "use", side, uid: r.uid }); }
      return;
    }
    const to = cancel ? d.from : d.over;
    const commit = () => {
      const ids = orderOf(moveItem(order, d.from, to));
      drag.current = null;
      setDragUid(null);
      if (to !== d.from) { setLocal({ ids, at: Date.now() }); send({ op: "order", side, order: ids }); }
      else for (const [u, el] of els.current) { el.style.transform = ""; springs.current.set(u, { x: 0, v: 0 }); targets.current.set(u, 0); }
    };
    sfx.ap("drop");
    setTargets(d.from, to, d.pitch);
    // The grabbed row glides from where it was let go into its new place, then the order is kept.
    springs.current.set(d.uid, { x: d.dy, v: 0 });
    targets.current.set(d.uid, (to - d.from) * d.pitch);
    d.active = false;
    if (reducedMotion()) { commit(); return; }
    settleDone.current = commit;
    kick();
  };
  const forget = (r: APRow) => {
    sfx.ap("forget");
    if (reducedMotion()) { send({ op: "forget", side, uid: r.uid }); return; }
    setLeaving(r.uid);
    window.setTimeout(() => { send({ op: "forget", side, uid: r.uid }); setLeaving(null); }, 200);
  };

  return (
    <div className={`ap-sec${dragUid ? " dragging" : ""}`} data-side={side}>
      <b className="ap-sec-t">{side === "speakers" ? AP_WORDS.speakers : AP_WORDS.mics}</b>
      {order.length === 0 && <span className="ap-empty">{AP_WORDS.empty}</span>}
      <div className="ap-list" role="list">
        {order.map((r, i) => (
          <div key={r.uid} role="listitem" data-uid={r.uid} aria-label={AP_WORDS.drag(r.name)} title={r.connected && !r.using ? AP_WORDS.use(r.name) : undefined}
            ref={(el) => { if (el) els.current.set(r.uid, el); else els.current.delete(r.uid); }}
            className={`ap-row${r.connected ? "" : " gone"}${r.using ? " using" : ""}${dragUid === r.uid ? " lifted" : ""}${leaving === r.uid ? " leaving" : ""}`}
            onPointerDown={(e) => down(e, i, r)} onPointerMove={move} onPointerUp={() => finish(false)} onPointerCancel={() => finish(true)}
            onLostPointerCapture={() => { if (drag.current?.active) finish(false); }}>
            <span className="ap-grip" aria-hidden="true"><svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="3" cy="3" r="1.2" /><circle cx="7" cy="3" r="1.2" /><circle cx="3" cy="7" r="1.2" /><circle cx="7" cy="7" r="1.2" /><circle cx="3" cy="11" r="1.2" /><circle cx="7" cy="11" r="1.2" /></svg></span>
            <span className="ap-num num">{i + 1}</span>
            <span className="ap-ic"><KindIcon kind={r.kind} side={side} name={r.name} /></span>
            <span className="ap-name"><span className="ap-nm">{r.name}</span>{!r.connected && <em>{AP_WORDS.notConnected}</em>}</span>
            {r.using && <span className="ap-use" key={`u-${r.uid}`}><i aria-hidden="true" />{AP_WORDS.inUse}</span>}
            {!r.connected && (
              <button type="button" className="ap-x" aria-label={AP_WORDS.forget(r.name)} title={AP_WORDS.forget(r.name)}
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onClick={(e) => { if (e.button !== 0) return; forget(r); }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            )}
          </div>
        ))}
      </div>
      {note && <span className={`ap-note${note === AP_WORDS.waiting ? " call" : ""}`} role="status">{note}</span>}
    </div>
  );
}

/** Both lists, at the top of the volume mixer. Nothing while the Mac has not said yet, or the switch is off there. */
export function AudioPriorityLists() {
  const st = useAudioPrio();
  useEffect(() => { send({ op: "get" }); }, []);
  if (!st || !st.on) return null;
  return (
    <div className="ap" role="group" aria-label={`${AP_WORDS.speakers} and ${AP_WORDS.mics}`}>
      {AP_SIDES.map((s) => <DeviceList key={s} side={s} rows={s === "speakers" ? st.speakers : st.mics} note={noteFor(st, s)} />)}
      <span className="ap-why">{AP_WORDS.why}</span>
    </div>
  );
}
