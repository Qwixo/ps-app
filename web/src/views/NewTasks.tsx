// New tasks: every task the developer did not type onto his list himself (his Telegram "AT" texts, Claude's
// suggestions from other chats) waits here until he accepts or declines it, so none get forgotten.
// While there are new ones, holding Tab shows a big pop-up in front of the list. The minimize
// button (top right) shrinks it into a glistening bubble just above Overdue; hovering the bubble
// grows it back. The pop-up and the bubble morph into each other (FLIP with the Web Animations API:
// one transform, GPU only). Accepted and declined cards slide out and close the gap.
//
// When it opens big: any suggestion newer than the last minimize (settings.tmInboxMinAt), or the developer
// hovered or clicked the bubble since the list opened. A new task arriving opens it big again.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { DimxZone, Doc, Suggestion, Todo } from "../core/model";
import { fmtDate } from "../ui/kit";
import { sfx } from "../ui/sfx";
import { orderForPriority, startSuggestDrag, taskMapActions } from "./TaskMap";
import "./newtasks.css";

// ---------- shared state (the bubble and the pop-up, in every list window on this page) ----------
// forced: the developer hovered or clicked the bubble, so the pop-up stays big until he minimizes it. It
// resets when the list closes. minAt: when he last minimized here (settings.tmInboxMinAt carries
// it to his other windows a moment later; this covers the gap).
type InboxState = { forced: boolean; minAt: number };
let inbox: InboxState = { forced: false, minAt: 0 };
const inboxListeners = new Set<() => void>();
function setInbox(p: Partial<InboxState>) { inbox = { ...inbox, ...p }; inboxListeners.forEach((l) => l()); }
function useInbox() {
  return useSyncExternalStore((l) => { inboxListeners.add(l); return () => { inboxListeners.delete(l); }; }, () => inbox);
}

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** cubic-bezier(x1, y1, x2, y2) as a function of time (0..1), for sampling keyframes by hand. */
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const at = (a: number, b: number, u: number) => 3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u;
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0, hi = 1, u = t;
    for (let i = 0; i < 22; i++) { u = (lo + hi) / 2; if (at(x1, x2, u) < t) lo = u; else hi = u; }
    return at(y1, y2, u);
  };
}
const EASE = bezier(0.22, 1, 0.36, 1);
const EASE_CSS = "cubic-bezier(.22,1,.36,1)";
const MORPH_MS = 520;
const POP_RADIUS = 28;

/**
 * The pop-up becomes the bubble ("out") or grows from it ("in"). The keyframes are sampled along
 * the easing curve so the corners can be corrected at every step: a scaled box with elliptical
 * radii of r/sx by r/sy draws a true round corner of r on screen, ending as the bubble's pill.
 */
function morph(pop: HTMLElement | null, slot: HTMLElement | null, dim: HTMLElement | null, dir: "in" | "out"): Promise<void> {
  if (!pop) return Promise.resolve();
  pop.style.animation = "none";
  const p = pop.getBoundingClientRect();
  const b = slot?.getBoundingClientRect();
  const quick = reduced() || !b || b.width < 4 || p.width < 4;
  const fill = dir === "out" ? "forwards" as const : "none" as const;
  dim?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: quick ? 160 : MORPH_MS * 0.8, easing: "ease", fill, direction: dir === "in" ? "reverse" : "normal" });
  if (quick) {
    const fade = [{ opacity: 1, transform: "none" }, { opacity: 0, transform: reduced() ? "none" : "scale(.96)" }];
    return pop.animate(fade, { duration: 180, easing: "ease", fill, direction: dir === "in" ? "reverse" : "normal" }).finished.then(() => {}, () => {});
  }
  const N = 24, frames: Keyframe[] = [];
  for (let k = 0; k <= N; k++) {
    const e = EASE(k / N);
    const t = dir === "out" ? e : 1 - e;           // 0 = the pop-up, 1 = the bubble
    const sx = 1 + (b!.width / p.width - 1) * t, sy = 1 + (b!.height / p.height - 1) * t;
    const r = POP_RADIUS + (b!.height / 2 - POP_RADIUS) * t;
    frames.push({ transform: `translate(${(b!.left - p.left) * t}px, ${(b!.top - p.top) * t}px) scale(${sx}, ${sy})`, borderRadius: `${r / sx}px / ${r / sy}px` });
  }
  pop.style.transformOrigin = "0 0";
  const a = pop.animate(frames, { duration: MORPH_MS, easing: "linear", fill });
  const body = pop.querySelector<HTMLElement>(".nt-body"), tint = pop.querySelector<HTMLElement>(".nt-morph");
  if (dir === "out") {
    body?.animate([{ opacity: 1 }, { opacity: 0, offset: 0.3 }, { opacity: 0 }], { duration: MORPH_MS, fill });
    tint?.animate([{ opacity: 0 }, { opacity: 1, offset: 0.55 }, { opacity: 1 }], { duration: MORPH_MS, fill });
  } else {
    body?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1 }], { duration: MORPH_MS, fill });
    tint?.animate([{ opacity: 1 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: MORPH_MS, fill });
  }
  return a.finished.then(() => {}, () => {});
}

function ago(iso: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
const fromTelegram = (s: Suggestion) => s.from === "telegram" || s.note === "From your Telegram";

type ClientOpt = { id: string; name: string };
// Where an accepted task can go: the list or a Dimension X band. (Urgent was retired on 4 Nov 2026:
// the Tab list's bottom right card is Overdue now, worked out from the tasks themselves.)
type Dest = "list" | DimxZone;
type How = Dest | "no";
const DESTS: { d: Dest; label: string; to: string }[] = [
  { d: "list", label: "My list", to: "to your list" },
  { d: "act", label: "Actionables", to: "to Actionables" },
  { d: "soon", label: "Upside Down", to: "to the Upside Down" },
  { d: "x", label: "Dimension X", to: "to Dimension X" },
];
/** Where Accept puts it: the band the developer named, else his list (ASAP ones too; they keep their red ASAP look here). */
const destOf = (s: Suggestion): Dest => s.zone ?? "list";

/**
 * The bubble (rendered where this sits: the right column, just above Overdue) and the big
 * pop-up (rendered at the list's root, or over the page when the list is docked on the To-do page).
 */
export function NewTasks({ list, clients, minAt, docked, prio, daily }: {
  list: Suggestion[]; clients: ClientOpt[]; minAt?: string | null; docked?: boolean;
  prio: Doc<Todo>[]; daily: Doc<Todo>[];
}) {
  const box = useInbox();
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const left = list.filter((s) => !leaving.has(s.id));
  const floor = Math.max(Date.parse(minAt || "") || 0, box.minAt);
  const fresh = list.some((s) => (Date.parse(s.createdAt) || 0) > floor);
  const want = list.length > 0 && (box.forced || fresh);

  // open: the pop-up is up. closing: it is morphing into the bubble. closed: only the bubble.
  const [phase, setPhase] = useState<"open" | "closing" | "closed">(want ? "open" : "closed");
  // lands: how many times the pop-up has shrunk into the bubble (each one replays the bounce).
  const [lands, setLands] = useState(0);
  const pop = useRef<HTMLElement>(null), slot = useRef<HTMLDivElement>(null), dim = useRef<HTMLDivElement>(null);
  const grow = useRef(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setHost(docked ? document.body : slot.current?.closest<HTMLElement>(".tm-overlay") ?? null); }, [docked]);

  useLayoutEffect(() => {
    if (want && phase !== "open") {
      pop.current?.getAnimations({ subtree: true }).forEach((a) => a.cancel());
      grow.current = true;
      setPhase("open");
    } else if (!want && phase === "open") setPhase("closing");
  }, [want]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (phase === "open" && grow.current && pop.current) {
      grow.current = false;
      void morph(pop.current, slot.current, dim.current, "in");
    } else if (phase === "closing") {
      // Into the bubble while there is one; when the last task is dealt with it just fades away.
      void morph(pop.current, list.length ? slot.current : null, dim.current, "out").then(() => {
        setPhase((p) => (p === "closing" ? "closed" : p));
        setLands((n) => n + 1);
      });
    }
  }, [phase, host]); // eslint-disable-line react-hooks/exhaustive-deps

  // Closing the list forgets a hover or click on the bubble; it opens small again next time.
  useEffect(() => () => setInbox({ forced: false }), []);

  // Cards that were accepted or declined leave the set once the task is gone from the data.
  useEffect(() => {
    if (!leaving.size) return;
    const ids = new Set(list.map((s) => s.id));
    if ([...leaving].some((id) => !ids.has(id))) setLeaving((cur) => new Set([...cur].filter((id) => ids.has(id))));
  }, [list, leaving]);

  const minimize = () => {
    if (phase !== "open") return;
    sfx.drop();
    const newest = Math.max(0, ...list.map((s) => Date.parse(s.createdAt) || 0));
    const at = Math.max(Date.now(), newest);
    setInbox({ forced: false, minAt: at });
    void taskMapActions.inboxMin(new Date(at).toISOString());
  };
  const expand = () => { if (!box.forced) { sfx.hover(); setInbox({ forced: true }); } };
  const dwell = useRef(0);
  useEffect(() => () => clearTimeout(dwell.current), []);

  // Accept (to its own place or any of the others) or decline. The card slides away, the gap closes, then it is saved.
  const items = useRef(new Map<string, HTMLDivElement>());
  const decide = (s: Suggestion, how: How, delay = 0) => {
    if (leaving.has(s.id)) return;
    if (delay === 0) { if (how === "no") sfx.click(); else sfx.done(); }
    setLeaving((cur) => new Set(cur).add(s.id));
    const act = () => how === "no" ? taskMapActions.suggest(s.id, "dismiss") : how === "list" ? taskMapActions.suggest(s.id, "add")
      : taskMapActions.suggest(s.id, "dimx", undefined, how);
    const el = items.current.get(s.id);
    const card = el?.firstElementChild as HTMLElement | null;
    if (!el || !card || reduced()) { void act(); return; }
    card.classList.add(how === "no" ? "no" : "yes");
    card.animate([{ transform: "none", opacity: 1 }, { transform: `translateX(${how === "no" ? -110 : 110}px) scale(.97)`, opacity: 0 }],
      { duration: 280, delay: delay + 90, easing: "cubic-bezier(.5,0,.75,0)", fill: "forwards" });
    el.style.overflow = "hidden";
    const close = el.animate([{ height: `${el.offsetHeight}px` }, { height: "0px", paddingBottom: "0px" }],
      { duration: 300, delay: delay + 330, easing: EASE_CSS, fill: "forwards" });
    // If the save never lands (eg PS lost its main window), the card comes back after a few seconds.
    void close.finished.catch(() => {}).then(() => act()).finally(() => window.setTimeout(() => {
      if (!el.isConnected) return;
      el.getAnimations({ subtree: true }).forEach((a) => a.cancel());
      el.style.overflow = "";
      card.classList.remove("yes", "no");
      setLeaving((cur) => { const n = new Set(cur); n.delete(s.id); return n; });
    }, 4000));
  };
  const acceptAll = () => { sfx.done(); left.forEach((s, i) => decide(s, destOf(s), i * 70 + 1)); };

  // Drag a card straight onto the list behind: the pop-up shrinks out of the way first.
  const lists = useRef({ prio, daily });
  lists.current = { prio, daily };
  const drop = (s: Suggestion, sec: "prio" | "daily", index: number, p1 = false) => {
    setLeaving((cur) => new Set(cur).add(s.id));
    const target = sec === "prio" ? lists.current.prio : lists.current.daily;
    // p1: let go inside the Priority 1 outline (TaskMap startSuggestDrag), so it joins that group.
    void taskMapActions.suggest(s.id, "add", { type: sec === "daily" ? "daily" : "once", order: orderForPriority(target, index + 1), p1: sec === "prio" && p1 });
  };

  if (!list.length && phase === "closed") return null;
  const name = (id?: string | null) => (id ? clients.find((c) => c.id === id)?.name : undefined);
  const n = left.length, asapN = left.filter((s) => s.asap).length;

  const popup = phase !== "closed" && (
    <div className={`nt-layer${docked ? " docked" : ""}`} onMouseDown={(e) => e.stopPropagation()}>
      <div ref={dim} className="nt-dim" onMouseDown={minimize} aria-hidden="true" />
      <section ref={pop} className="nt-pop" role="dialog" aria-modal="true" aria-labelledby="nt-title">
        <div className="nt-morph" aria-hidden="true" />
        <div className="nt-body">
          <header className="nt-head">
            <h2 id="nt-title" className="nt-title">
              <Spark /> New tasks <span className="nt-count num">{n}</span>
            </h2>
            <p className="nt-sub">Accept or decline each one. Nothing joins your list until you say so.</p>
            <div className="nt-head-act">
              {n > 1 && <button type="button" className="nt-all" onClick={acceptAll}>Accept all</button>}
              <button type="button" className="nt-min" onClick={minimize} aria-label="Minimize to a bubble" title="Minimize">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 10l6-6M14 10h5M14 10V5M10 14l-6 6M10 14H5M10 14v5" /></svg>
              </button>
            </div>
          </header>
          <div className="nt-list">
            {list.map((s) => {
              const tg = fromTelegram(s);
              const note = s.note && s.note !== "From your Telegram" ? s.note : null;
              const main = destOf(s), mainD = DESTS.find((x) => x.d === main)!;
              return (
                <div key={s.id} className="nt-item" ref={(el) => { if (el) items.current.set(s.id, el); else items.current.delete(s.id); }}>
                  <article className={`nt-card${s.asap ? " asap" : ""}`} onMouseEnter={() => sfx.hover()} title="Drag onto your list, or accept or decline it"
                    onPointerDown={(e) => { if (!leaving.has(s.id)) startSuggestDrag(e, s.title, (sec, i, p1) => drop(s, sec, i, p1), minimize); }}>
                    <div className="nt-main">
                      <h3 className="nt-t">{s.title}</h3>
                      <div className="nt-chips">
                        {s.asap && <span className="nt-chip asap">ASAP</span>}
                        <span className={`nt-chip ${tg ? "tg" : "cl"}`}>{tg ? <TelegramIcon /> : <Spark size={13} />}{tg ? "Telegram" : "Claude"}</span>
                        {s.zone && <span className={`nt-chip zone z-${s.zone}`}>{DESTS.find((x) => x.d === s.zone)!.label}</span>}
                        {name(s.clientId) && <span className="nt-chip client">{name(s.clientId)}</span>}
                        {s.type === "daily" ? <span className="nt-chip">Every day</span> : s.due ? <span className="nt-chip num">Due {fmtDate(s.due)}</span> : null}
                        <span className="nt-ago">{ago(s.createdAt)}</span>
                      </div>
                      {note && <p className="nt-note">{note}</p>}
                      <div className="nt-dests" role="group" aria-label="Or accept it to">
                        <span className="nt-dests-l">Or to</span>
                        {DESTS.filter((x) => x.d !== main).map((x) => (
                          <button key={x.d} type="button" className={`nt-dest d-${x.d}`} onClick={() => decide(s, x.d)} aria-label={`Accept ${x.to}: ${s.title}`}>
                            <i aria-hidden="true" />{x.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="nt-act">
                      <button type="button" className="nt-yes" onClick={() => decide(s, main)} aria-label={`Accept ${mainD.to}: ${s.title}`}>
                        <span><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>Accept</span>
                        <small>{mainD.to}</small>
                      </button>
                      <button type="button" className="nt-no" onClick={() => decide(s, "no")} aria-label={`Decline: ${s.title}`}>Decline</button>
                    </div>
                  </article>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );

  return (
    <>
      {/* The bubble's place is always kept (invisible while the pop-up is up) so the morph knows where to go. */}
      <div ref={slot} className={`nt-slot${phase === "closed" ? " show" : ""}${lands ? " arrived" : ""}`} onMouseDown={(e) => e.stopPropagation()}
        aria-hidden={phase !== "closed"}>
        {n > 0 && <>
          <span className="nt-glow" aria-hidden="true" />
          <button key={lands} type="button" className={`nt-bubble${lands ? " land" : ""}`} tabIndex={phase === "closed" ? 0 : -1}
            onMouseEnter={() => { clearTimeout(dwell.current); dwell.current = window.setTimeout(expand, 200); }}
            onMouseLeave={() => clearTimeout(dwell.current)} onClick={expand}
            aria-label={`${n} new task${n > 1 ? "s" : ""} to accept or decline`} title="New tasks: accept or decline">
            <span className="nt-b-n num">{n}</span>
            <span className="nt-b-l">New task{n > 1 ? "s" : ""}<small>{asapN ? `${asapN} ASAP` : "Accept or decline"}</small></span>
            <span className="nt-b-sheen" aria-hidden="true" />
          </button>
        </>}
      </div>
      {popup && host && createPortal(popup, host)}
    </>
  );
}

function Spark({ size = 22 }: { size?: number }) {
  return (
    <svg className="nt-spark" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.8 5.4L19 9.2l-5.2 1.8L12 16.4l-1.8-5.4L5 9.2l5.2-1.8z" /><path d="M19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z" opacity=".8" />
    </svg>
  );
}
function TelegramIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21.4 3.6L2.9 10.8c-1.3.5-1.2 1.3-.2 1.6l4.7 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2.9-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.6c.3-1.3-.5-1.9-1.5-1.3zM9.6 14.3l-.4 4.1-1.5-4.8 10.9-6.9-9 7.6z" />
    </svg>
  );
}
