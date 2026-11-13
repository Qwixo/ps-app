// PS Fitness navigation (V1.43, the developer: "add a nav bar, maybe with a donut icon, so you click it and see all the options").
// The round menu button (a donut ring until V1.47, now a three line hamburger) sits in the same top left corner on every screen. A tap opens the menu: Home,
// then every section with its icon and one plain line, and at the bottom Sync and light or dark. On a wide Mac screen
// the same list is a slim bar down the left. Back, Esc and the phone's back gesture close the menu first.
// "Pick your look" (first launch and from Settings) is here too: the three looks in light and dark as live previews.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { haptic } from "../gos/bridge";
import { RIR_VALUES, rirLabel, type FitStyle } from "../core/fitness";
import { SECTIONS, HOME, SETUP, type FitSection } from "./nav-logic";
import { type FitTheme } from "./theme";
import { PeopleIcon } from "./Squad";

// ---------- a screen inside a section (V1.43) ----------
// A section that opens its own full screen (a program's exercise, Add an exercise, a workout in History) puts that
// screen's title in Fitness's top bar, so the top left Back arrow and the title always describe what is on screen,
// and the donut menu stays in reach. The Back arrow sends the phone's back event, which that screen closes on.
let subTitle: string | null = null;
const subSubs = new Set<() => void>();
const subEmit = () => subSubs.forEach((f) => f());
export function useFitSub(title: string | null) {
  useEffect(() => {
    if (title == null) return;
    subTitle = title; subEmit();
    return () => { if (subTitle === title) { subTitle = null; subEmit(); } };
  }, [title]);
}
export const useFitSubTitle = () => useSyncExternalStore((f) => { subSubs.add(f); return () => { subSubs.delete(f); }; }, () => subTitle, () => subTitle);

// ---------- icons (one stroke set, 24 x 24) ----------
const I = ({ children, size = 22, w = 2.2 }: { children: ReactNode; size?: number; w?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
export const NavIcons: Record<FitSection, (p: { size?: number }) => ReactNode> = {
  home: ({ size }) => <I size={size}><path d="M3.5 11.2L12 4l8.5 7.2" /><path d="M6 9.5V20h12V9.5" /><path d="M10 20v-5.5h4V20" /></I>,
  gym: ({ size }) => <I size={size}><path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11" /></I>,
  plan: ({ size }) => <I size={size}><rect x="4.5" y="3.5" width="15" height="17" rx="2.5" /><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4.5" /></I>,
  history: ({ size }) => <I size={size}><path d="M3.8 12a8.2 8.2 0 1 0 2.4-5.8" /><path d="M3.5 4.5v3.8h3.8" /><path d="M12 7.8V12l3 2" /></I>,
  bests: ({ size }) => <I size={size}><path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z" /><path d="M7.5 6H4.5a3 3 0 0 0 3 4M16.5 6h3a3 3 0 0 1-3 4" /><path d="M12 13.5V17M8.5 20.5h7M9.5 17h5v3.5h-5z" /></I>,
  exercises: ({ size }) => <I size={size}><circle cx="12" cy="4.6" r="1.9" /><path d="M5 9.2l7 1.3 7-1.3" /><path d="M12 10.5v4.2l-3.4 5.8M12 14.7l3.4 5.8" /></I>,
  sleep: ({ size }) => <I size={size}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></I>,
  squad: ({ size }) => <PeopleIcon size={size ?? 22} />,
  setup: ({ size }) => <I size={size}><path d="M5 12.5l3.5 3.5L15 9.5" /><path d="M13 4.5h6.5V11" /><path d="M19.5 4.5L12.5 11.5" /><path d="M19.5 15v4.5H4.5v-15H9" /></I>,
  settings: ({ size }) => <I size={size}><circle cx="12" cy="12" r="3.1" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></I>,
};
export const BackIcon = () => <I size={24} w={2.6}><path d="M15 5l-7 7 7 7" /></I>;
const XIcon = () => <I size={22} w={2.4}><path d="M6 6l12 12M18 6L6 18" /></I>;
const Chevron = () => <I size={18} w={2.4}><path d="M9 6l6 6-6 6" /></I>;
const Check = () => <I size={16} w={3}><path d="M5 12.5l4.5 4.5L19 7.5" /></I>;

/** The round menu button (V1.47: a three line hamburger, the developer: "Make it look like a hamburger icon navbar instead, to
 *  make it obvious it's a navbar"; it was a donut ring). Open, the lines fold into an X. A small amber dot shows when
 *  a change is still waiting to sync. The fit-donut class names stay so every look and the side bar keep working. */
export function DonutButton({ open, onClick, warn, className }: { open: boolean; onClick: () => void; warn?: boolean; className?: string }) {
  return (
    <button type="button" className={`fit-donut${open ? " open" : ""}${className ? ` ${className}` : ""}`} onClick={() => { haptic("press"); onClick(); }}
      aria-expanded={open} aria-haspopup="dialog" aria-label={open ? "Close the Fitness menu" : "Open the Fitness menu"} data-tip={open ? "Close the menu" : "Menu"} data-tip-line={open ? "Or press Esc" : "Home, Today, Programs, History and the rest"}>
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" className="fit-burger">
        <path className="fit-burger-l fit-burger-t" d="M5 7.5h16" />
        <path className="fit-burger-l fit-burger-m" d="M5 13h16" />
        <path className="fit-burger-l fit-burger-b" d="M5 18.5h16" />
      </svg>
      {warn && <i className="fit-donut-warn" aria-hidden="true" />}
    </button>
  );
}

/** One section row (menu and side bar). */
function Row({ k, title, line, on, slim, onPick }: { k: FitSection; title: string; line?: string; on: boolean; slim?: boolean; onPick: (k: FitSection) => void }) {
  const Icon = NavIcons[k];
  return (
    <button type="button" className={`fit-nav-row${on ? " on" : ""}${slim ? " slim" : ""}`} aria-current={on ? "page" : undefined}
      onClick={() => { haptic("press"); onPick(k); }}>
      <span className="fit-nav-i" aria-hidden="true"><Icon /></span>
      <span className="fit-nav-t"><b>{title}</b>{line && <small>{line}</small>}</span>
      {!slim && <span className="fit-nav-go" aria-hidden="true"><Chevron /></span>}
    </button>
  );
}

/** The menu: a panel that grows out of the donut. Closes on a pick, the dim, the X, Esc and the back gesture. */
export function FitMenu({ cur, onPick, onClose, foot }: { cur: FitSection; onPick: (k: FitSection) => void; onClose: () => void; foot?: ReactNode }) {
  const [out, setOut] = useState(false);
  const gone = useRef(false);
  const doneRef = useRef(onClose);
  doneRef.current = onClose;
  const close = (then?: () => void) => {
    if (gone.current) return;
    gone.current = true; setOut(true);
    window.setTimeout(() => { doneRef.current(); then?.(); }, 170);
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.closest(".fit-menu")?.querySelector<HTMLButtonElement>(".fit-nav-row.on, .fit-nav-row")?.focus({ preventScroll: true });
    const back = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); closeRef.current(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeRef.current(); } };
    window.addEventListener("gos-back", back, true);
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("gos-back", back, true); window.removeEventListener("keydown", key, true); };
  }, []);
  const pick = (k: FitSection) => { onPick(k); close(); };
  return (
    <div className={`fit-menu-layer${out ? " out" : ""}`}>
      <div className="fit-menu-dim" onClick={() => close()} aria-hidden="true" />
      <nav className="fit-menu" role="dialog" aria-modal="true" aria-label="Fitness menu">
        <header className="fit-menu-h">
          <DonutButton open onClick={() => close()} className="fit-menu-donut" />
          <b>Fitness</b>
          <button ref={first} type="button" className="fit-menu-x" onClick={() => close()} aria-label="Close the menu" data-tip="Close the menu" data-tip-line="Or press Esc"><XIcon /></button>
        </header>
        <div className="fit-menu-list">
          <Row k="home" title="Home" line={HOME.line} on={cur === "home"} onPick={pick} />
          <div className="fit-menu-sep" aria-hidden="true" />
          {SECTIONS.map((s) => <Row key={s.k} k={s.k} title={s.title} line={s.line} on={cur === s.k} onPick={pick} />)}
          <div className="fit-menu-sep" aria-hidden="true" />
          <Row k="setup" title={SETUP.title} line={SETUP.line} on={cur === "setup"} onPick={pick} />
        </div>
        {foot && <footer className="fit-menu-f">{foot}</footer>}
      </nav>
    </div>
  );
}

/** The Mac's slim bar down the left, shown when there is room (fitness.css shows it from 980 px wide). */
export function FitRail({ cur, onPick, onMenu, menuOpen, warn, foot }: { cur: FitSection; onPick: (k: FitSection) => void; onMenu: () => void; menuOpen: boolean; warn?: boolean; foot?: ReactNode }) {
  return (
    <nav className="fit-rail" aria-label="Fitness sections">
      <div className="fit-rail-in">
        <div className="fit-rail-top"><DonutButton open={menuOpen} onClick={onMenu} warn={warn} /><b>Fitness</b></div>
        <Row k="home" title="Home" on={cur === "home"} slim onPick={onPick} />
        <div className="fit-menu-sep" aria-hidden="true" />
        {SECTIONS.map((s) => <Row key={s.k} k={s.k} title={s.title} on={cur === s.k} slim onPick={onPick} />)}
        <div className="fit-menu-sep" aria-hidden="true" />
        <Row k="setup" title="Set up training" on={cur === "setup"} slim onPick={onPick} />
        {foot && <div className="fit-rail-foot">{foot}</div>}
      </div>
    </nav>
  );
}

// ======================================================================================================
// Pick your look (first launch, and Settings > Look > See every look)
// ======================================================================================================
export const LOOK_SEEN_KEY = "fit.lookSeen";
export function lookSeen(): boolean { try { return localStorage.getItem(LOOK_SEEN_KEY) === "1"; } catch { return true; } }
export function markLookSeen() { try { localStorage.setItem(LOOK_SEEN_KEY, "1"); } catch { /* storage off: shown again next time */ } }

const LOOKS: { k: FitStyle; t: FitTheme; name: string; d: string }[] = [
  { k: "volt", t: "dark", name: "Volt dark", d: "Graphite and gold" },
  { k: "volt", t: "light", name: "Volt light", d: "White and gold" },
  { k: "chalk", t: "light", name: "Chalk light", d: "High contrast for a bright gym" },
  { k: "chalk", t: "dark", name: "Chalk dark", d: "Black, white and yellow" },
  { k: "pulse", t: "dark", name: "Pulse dark", d: "Deep blue glow" },
  { k: "pulse", t: "light", name: "Pulse light", d: "Bright blue and violet" },
];

/** A tiny live Fitness home drawn with that look's own tokens. */
function LookMini({ k, t }: { k: FitStyle; t: FitTheme }) {
  return (
    <span className="fit fl-mini" data-fit-style={k} data-fit-theme={t} aria-hidden="true">
      <span className="fl-bar"><svg width="14" height="14" viewBox="0 0 26 26"><circle cx="13" cy="13" r="8.2" fill="none" stroke="currentColor" strokeWidth="4.6" /></svg><b>Fitness</b></span>
      <span className="fl-card">
        <small>Up next</small>
        <b className="f-num">Day 2</b>
        <span className="fl-go">Start</span>
      </span>
      <span className="fl-row">
        <span className="fl-num"><b className="f-num">52.5</b><small>kg</small></span>
        <span className="fl-num"><b className="f-num">8</b><small>reps</small></span>
        <span className="fl-tick"><Check /></span>
      </span>
      <span className="fl-rir">{RIR_VALUES.map((r) => <span key={r} className={`f-num${r === 2 ? " on" : ""}`}>{rirLabel(r)}</span>)}</span>
    </span>
  );
}

export function LookPicker({ style, theme, first, onPick, onDone }: { style: string; theme: FitTheme; first?: boolean; onPick: (k: FitStyle, t: FitTheme) => void; onDone: () => void }) {
  const [out, setOut] = useState(false);
  const gone = useRef(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const close = () => { if (gone.current) return; gone.current = true; setOut(true); window.setTimeout(() => doneRef.current(), 200); };
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const back = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); closeRef.current(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeRef.current(); } };
    window.addEventListener("gos-back", back, true);
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("gos-back", back, true); window.removeEventListener("keydown", key, true); };
  }, []);
  const cur = LOOKS.find((l) => l.k === style && l.t === theme) ?? null;
  return (
    <div className={`fit-look-layer${out ? " out" : ""}`} role="dialog" aria-modal="true" aria-label="Pick your look">
      <div className="fit-look">
        <header className="fit-look-h">
          <h2>Pick your look</h2>
          <p>{first ? "Tap one to try it. You can change it any time in Settings." : "Tap one to try it on the whole of Fitness."}</p>
        </header>
        <div className="fit-look-grid" role="radiogroup" aria-label="Look">
          {LOOKS.map((l) => {
            const on = cur?.k === l.k && cur?.t === l.t;
            return (
              <button key={`${l.k}-${l.t}`} type="button" role="radio" aria-checked={on} className={`fit-look-tile${on ? " on" : ""}`}
                onClick={() => { haptic("press"); onPick(l.k, l.t); }}>
                <LookMini k={l.k} t={l.t} />
                <span className="fit-look-name"><b>{l.name}</b><small>{l.d}</small></span>
                <span className="fit-look-check" aria-hidden="true"><Check /></span>
              </button>
            );
          })}
        </div>
        <footer className="fit-look-f">
          <button type="button" className="fit-look-done" onClick={() => { haptic("press"); close(); }}>{cur ? `Use ${cur.name}` : "Done"}</button>
        </footer>
      </div>
    </div>
  );
}

// ======================================================================================================
// Minimise, explained once (V1.43, the developer found the pop up's Minimise confusing)
// ======================================================================================================
export const MIN_HINT_KEY = "fit.minHint";
export function minHintSeen(): boolean { try { return localStorage.getItem(MIN_HINT_KEY) === "1"; } catch { return true; } }
/** A small card under the top bar, pointing at Minimise, the first time a workout is open in the pop up. */
export function MinHint({ onDone }: { onDone: () => void }) {
  const done = () => { try { localStorage.setItem(MIN_HINT_KEY, "1"); } catch { /* storage off */ } onDone(); };
  return (
    <div className="fit-minhint" role="note">
      <p><b>Minimise</b> shrinks Fitness to a small timer bubble, so you can use your phone between sets. Your workout keeps going. Tap the bubble to come back.</p>
      <button type="button" onClick={() => { haptic("press"); done(); }}>Got it</button>
    </div>
  );
}
