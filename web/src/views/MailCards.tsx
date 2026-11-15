// The website's client email cards (top right, under the header): the same cards PS shows, from the
// same vault list (core/mailcards.ts). They stay until the developer clicks Dismiss; a Dismiss here clears the
// card in PS too, and the reverse. Opening the email never dismisses it. Not shown inside PS (PS has
// its own pop-up stack). On PS GOS they are the strip under the header.
// "Remind me in 15 mins" hides the card on every device until then. With a mouse, the wheel over the
// button changes the time (up adds 5 minutes, down takes 5); on the phone a drag up or down does,
// with a light tap of the haptics per step. A click or a plain tap sets the time shown.
import { useEffect, useRef, useState } from "react";
import { settingsData } from "../core/select";
import { saveSettings, setReplyRemind, setReplySeen } from "../core/actions";
import { mailCards, nextRemind, remindText, REMIND, stepRemind } from "../core/mailcards";
import { useVault } from "../ui/kit";
import { PS } from "../ps";
import { haptic } from "../gos/bridge";
import "./mailcards.css";

const SHOW = 3;
const DRAG_STEP = 22;   // px of finger travel per 5 minutes

export function MailCardsWeb() {
  const s = useVault();
  const [open, setOpen] = useState(false);
  // Gone a moment ago (Dismiss or Remind): hidden at once while the vault save is on its way.
  const [gone, setGone] = useState<Map<string, number>>(new Map());
  const [, setTick] = useState(0);
  const ready = !PS && s.status === "unlocked" && s.role === "owner";
  const since = ready ? settingsData(s).mailCardsSince : "x";
  // First run on any device: start from now, so old mail never floods in.
  useEffect(() => { if (ready && !since) void saveSettings({ mailCardsSince: new Date().toISOString() }); }, [ready, since]);
  // A reminded card comes back on time, with nothing else changing.
  const next = ready && since ? nextRemind(s.docs.values(), since) : 0;
  useEffect(() => {
    if (!next) return;
    const t = window.setTimeout(() => setTick((n) => n + 1), Math.min(Math.max(next - Date.now() + 300, 300), 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [next]);
  if (PS || s.status !== "unlocked" || s.role !== "owner") return null;
  const st = settingsData(s);
  if (!st.mailCardsSince) return null;
  const now = Date.now();
  const list = mailCards(s.docs.values(), st.mailCardsSince).filter((c) => (gone.get(c.id) || 0) < now - 15_000);
  if (!list.length) return null;
  const shown = open ? list : list.slice(0, SHOW);
  const hide = (id: string) => setGone((g) => new Map(g).set(id, Date.now()));
  const dismiss = (id: string, replyId: string) => { hide(id); void setReplySeen(replyId); };
  const remind = (id: string, replyId: string, mins: number) => { hide(id); void setReplyRemind(replyId, mins); };
  return (
    <aside className="mc" aria-label="New client emails">
      {shown.map((c) => (
        <article key={c.id} className="mc-card">
          <header><span className="mc-ic" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M4 7.5l8 5.5 8-5.5" /></svg></span>
            <b>{c.title}</b><time>{new Date(c.at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</time></header>
          {c.sub && <p className="mc-sub">{c.sub}</p>}
          {c.body && <p className="mc-b">{c.body}</p>}
          <div className="mc-acts">
            <a className="mc-open" href={c.url} target="_blank" rel="noopener noreferrer">Open in Gmail</a>
            <RemindButton onSet={(mins) => remind(c.id, c.replyId, mins)} />
            <button type="button" className="mc-dis" onClick={() => dismiss(c.id, c.replyId)}>Dismiss</button>
          </div>
        </article>
      ))}
      {list.length > SHOW && <button type="button" className="mc-more" onClick={() => setOpen((o) => !o)}>{open ? "Show less" : `${list.length - SHOW} more`}</button>}
    </aside>
  );
}

/** "Remind me in 15 mins": wheel (mouse) or vertical drag (touch) in 5 minute steps, click or tap sets it. */
function RemindButton({ onSet }: { onSet: (mins: number) => void }) {
  const [mins, setMins] = useState<number>(REMIND.start);
  const [dir, setDir] = useState(0);
  const ref = useRef<HTMLButtonElement>(null);
  const cur = useRef<number>(REMIND.start);
  const dragged = useRef(false);
  const set = (m: number, d: number) => {
    if (m === cur.current) return false;
    cur.current = m; setMins(m); setDir(d);
    return true;
  };
  // The wheel: a native listener, because React's wheel events can not stop the page from scrolling.
  useEffect(() => {
    const b = ref.current;
    if (!b) return;
    let acc = 0, last = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); e.stopPropagation();
      // The direction the wheel turned (WebKit says when the system flips it for natural scrolling): up is negative.
      const flipped = (e as WheelEvent & { webkitDirectionInvertedFromDevice?: boolean }).webkitDirectionInvertedFromDevice === true;
      acc += flipped ? -e.deltaY : e.deltaY;
      const t = Date.now();
      if (Math.abs(acc) < 4 || t - last < 60) return;
      const d = acc < 0 ? 1 : -1;
      acc = 0; last = t;
      set(stepRemind(cur.current, d), d);
    };
    b.addEventListener("wheel", onWheel, { passive: false });
    return () => b.removeEventListener("wheel", onWheel);
  }, []);
  // Touch: drag up for more, down for less. The page does not scroll while the finger is on it.
  const drag = useRef<{ id: number; y: number; from: number } | null>(null);
  const onDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    dragged.current = false;
    if (e.pointerType === "mouse") return;
    drag.current = { id: e.pointerId, y: e.clientY, from: cur.current };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const g = drag.current;
    if (!g || g.id !== e.pointerId) return;
    const dy = g.y - e.clientY;
    if (Math.abs(dy) > 8) dragged.current = true;
    const steps = Math.trunc(dy / DRAG_STEP);
    const m = Math.max(REMIND.min, Math.min(REMIND.max, g.from + steps * REMIND.step));
    if (set(m, m > cur.current ? 1 : -1)) haptic("tick");
  };
  const onUp = () => { drag.current = null; };
  const label = remindText(mins);
  return (
    <button type="button" ref={ref} className="mc-rem" title="Scroll or drag to change, click to set"
      aria-label={`Remind me in ${label}`}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onClick={() => { if (dragged.current) { dragged.current = false; return; } onSet(cur.current); }}>
      <span className="mc-rem-in">Remind me in <span key={mins} className={`mc-rem-v${dir > 0 ? " up" : dir < 0 ? " down" : ""}`}>{label}</span></span>
      <svg className="mc-rem-ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 9l4-4 4 4M8 15l4 4 4-4" /></svg>
    </button>
  );
}
