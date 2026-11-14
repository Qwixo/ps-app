// Feature intros (PS 1.60): the one piece that draws every "Did you know?" from the island. What it says and when it may show is in
// core/featureintro.ts (the list INTROS and the rules). The next intro is a new entry there (docs/feature-intros.md): no new animation
// code here. Only two small tables below know the pictures and guides by name (MARKS, GUIDES) and one more knows how to tell the person
// already did it (DONE_PROBES).
//
// Where it shows:
//  - The Mac: the island squeezes in a little and a chime plays (Sources/SetupIsland.swift intro), then this card hangs from the
//    island, same black, growing out of its width, the mark swooping in on a spring. "Show me" grows the card into the guide, still
//    attached. Esc closes it and the island is itself again. The Mac's shared queue decides the turn (never over a meeting, reminder,
//    stand up, What's new, Welcome back or any other card) and the Mac says no for Sentry mode, Sleep mode, screen sharing and full screen.
//  - The website and the phone: the same card, plain (no island to hang from), at the top of the page, with the page's own queue.
//    The phone's Back closes it (gos-back). Reduced motion turns the animation off.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PS, psPost, useOverlayShown } from "../ps";
import { askScreenRec, screenRecNow } from "../screenrec";
import { introAudience } from "../core/screenrecmeet";
import { useVault } from "../ui/kit";
import { settingsData } from "../core/select";
import { dndActive } from "../core/dnd";
import { feature } from "../core/features";
import { mailCan } from "../core/mailswitch";
import { attachedLayout, ISLAND_ASK_MS, ISLAND_QUEUED_MS, type IslandAnchor } from "../core/whatsnew";
import { addActive, answer, CARD_W, cleanState, INTROS, introReply, markShown, nextIntro, recheckMs, retire, type IntroDef, type IntroState } from "../core/featureintro";
import { sleepState } from "../sleepmode/engine";
import { sentryUp } from "./Sentry";
import { popupOn, tipOn, walkOn } from "./popupstate";
import { useWelcomeShowing } from "./Welcome";
import { useFaceShowing, useIslandTurn, useWhatsNewShowing, islandCards } from "../updateface";
import { readWaStatus } from "./WhatsAppSettings";
import { WaGuide } from "./WaGuide";
import { WaMark } from "./WaMark";
import { sfx } from "../ui/sfx";
import "./featureintro.css";

const KEY = "ps.featureIntros";
const load = (): IntroState => { try { return cleanState(JSON.parse(localStorage.getItem(KEY) || "null")); } catch { return cleanState(null); } };
const save = (s: IntroState) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window: it asks again next time */ } };

/** The pictures that swoop in, by the name in the list. */
const MARKS: Record<IntroDef["mark"], (size: number) => ReactNode> = {
  whatsapp: (n) => <WaMark size={n} />,
  record: recordMark,
  spark: (n) => (
    <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke="#FFD60A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />
    </svg>
  ),
};
/** The Record mark: a screen with a red dot. */
function recordMark(n: number) {
  return (
  <svg width={n} height={n} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="3" /><circle cx="12" cy="12" r="3" fill="#FF453A" stroke="#FF453A" />
  </svg>
  );
}
/** The guides "Show me" opens, by the name in the list. */
const GUIDES: Record<NonNullable<IntroDef["guide"]>, (p: { onClose: () => void; anchor: IslandAnchor | null }) => ReactNode> = {
  "wa-link": (p) => <WaGuide onClose={p.onClose} anchor={p.anchor} />,
};
/** Has the person already done what the intro is about? "done" retires it for good. "open" keeps it. "unknown" waits (never shows on a guess). */
const DONE_PROBES: Record<string, (can: boolean) => Promise<"done" | "open" | "unknown">> = {
  // Screen recording (12b): shown only to people who said No or have not answered. Yes retires it. Asks the Mac for its saved choice only (nothing from macOS).
  screenrec: async () => { askScreenRec(); return introAudience({ mac: PS, st: screenRecNow() }); },
  whatsapp: async (can) => {
    if (!can) return "unknown";   // no own Supabase project to link (yet): wait and look again, never retire for good on what may be a still loading vault
    const st = await readWaStatus();
    return !st ? "unknown" : st.linked ? "done" : "open";
  },
};

/** Mounted once, next to the What's new panel (views/PsApp.tsx for the Mac, App.tsx for the website and the phone). */
export function FeatureIntroHost() {
  const s = useVault();
  const listShown = useOverlayShown();
  const welcome = useWelcomeShowing(), face = useFaceShowing(), wn = useWhatsNewShowing();
  const [state, setState] = useState<IntroState>(load);
  const stateRef = useRef(state);
  const [open, setOpen] = useState<IntroDef | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const probe = useRef<Record<string, "done" | "open" | "unknown">>({});
  const holdUntil = useRef(0);
  const probeAt = useRef<Record<string, number>>({});
  const lastInput = useRef(Date.now());
  const can = mailCan(s);
  const live = useRef({ s, listShown, welcome, face, wn, can });
  live.current = { s, listShown, welcome, face, wn, can };
  const commit = useCallback((f: (x: IntroState) => IntroState) => { const n = f(stateRef.current); stateRef.current = n; save(n); setState(n); }, []);

  // 12b: the Mac's saved screen recording choice is read once, early, so the screen recording intro knows who said No (nothing from macOS).
  useEffect(() => { if (PS) askScreenRec(); }, []);

  // Any key, click, scroll or move is use. Nothing is read from what is typed (only that something happened).
  useEffect(() => {
    const t = () => { lastInput.current = Date.now(); };
    const ev = ["keydown", "pointerdown", "wheel", "pointermove", "touchstart"] as const;
    ev.forEach((e) => window.addEventListener(e, t, { passive: true, capture: true }));
    return () => ev.forEach((e) => window.removeEventListener(e, t, { capture: true }));
  }, []);

  // The one clock: count active use, and look every few seconds at whether an intro may show. Nothing here waits or loops on the main thread.
  useEffect(() => {
    let last = Date.now(), checking = false;
    const tick = () => {
      const now = Date.now(), L = live.current;
      const visible = document.visibilityState !== "hidden";
      commit((x) => addActive(x, { version: __PS_VERSION__.name, deltaMs: now - last, idleMs: now - lastInput.current, listShown: L.listShown && visible }));
      last = now;
      if (openRef.current || checking || now < holdUntil.current || L.s.status !== "unlocked") return;
      const st = settingsData(L.s);
      const fullScreen = !!document.fullscreenElement;
      const facts = {
        now,
        notForThem: INTROS.filter((d) => probe.current[d.id] === "done" || probe.current[d.id] === "unknown").map((d) => d.id),
        islandBusy: L.welcome || L.face || L.wn || popupOn() || tipOn() || walkOn() || !!islandCards.queue.active || islandCards.queue.waiting.length > 0,
        sleep: sleepState().here, sentry: sentryUp(), dnd: dndActive(st.dnd, now), sharing: false, fullScreen,
        off: !feature("feature-intros"),
      };
      // "Did they already do it?" is read for the intro that is next in line, only once the clock says it could show (one small read,
      // again after 5 minutes). Unknown (the read failed) never shows on a guess.
      // 12b: the first intro whose read is due (an intro that is waiting for its next read never blocks the ones behind it).
      const pending = INTROS.find((d) => !stateRef.current.recs[d.id]?.closed && probe.current[d.id] !== "done" && !!DONE_PROBES[d.id]
        && (probe.current[d.id] === undefined || now >= (probeAt.current[d.id] ?? 0)));
      const read = pending ? DONE_PROBES[pending.id] : undefined;
      if (pending && read && stateRef.current.activeMs >= 55_000) {
        checking = true; probeAt.current[pending.id] = now + 5 * 60_000;
        void read(live.current.can).then((r) => {
          probe.current[pending.id] = r;
          if (r === "done") commit((x) => retire(x, pending.id, Date.now()));
        }).catch(() => { probe.current[pending.id] = "unknown"; }).finally(() => { checking = false; });
        return;
      }
      const pick = nextIntro(stateRef.current, facts);
      if (!pick) return;
      if ("wait" in pick) { if (pick.wait !== "notActive") holdUntil.current = now + Math.min(recheckMs(pick.wait), 60_000); return; }
      setOpen(pick.show);
    };
    const t = window.setInterval(tick, 5000);
    return () => window.clearInterval(t);
  }, [commit]);

  const onShown = useCallback((id: string) => commit((x) => markShown(x, id, Date.now())), [commit]);
  const onAnswer = useCallback((id: string, a: "show" | "later") => commit((x) => answer(x, id, a)), [commit]);
  const onGone = useCallback((why?: string) => {
    setOpen(null);
    holdUntil.current = Date.now() + (why ? recheckMs("busy") : 15_000);
  }, []);
  if (!open) return null;
  return <IntroStage key={open.id} def={open} onShown={onShown} onAnswer={onAnswer} onGone={onGone} />;
}

type Phase = "ask" | "card" | "guide" | "out";

function IntroStage({ def, onShown, onAnswer, onGone }: { def: IntroDef; onShown: (id: string) => void; onAnswer: (id: string, a: "show" | "later") => void; onGone: (why?: string) => void }) {
  const viaIsland = PS && feature("island-moments");
  // The page's own queue first (a web card of this page goes before it), then on the Mac the island's queue.
  const turn = useIslandTurn(`intro:${def.id}`, true, "low");
  const [phase, setPhase] = useState<Phase>("ask");
  const [anchor, setAnchor] = useState<IslandAnchor | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const asked = useRef(false);
  const [guide, setGuide] = useState(false);
  const vault = useVault();

  useEffect(() => {
    if (!turn || asked.current) return;
    asked.current = true;
    // Its turn may come long after the clock said yes (another card held the page queue): the quiet places are looked at once more now.
    if (dndActive(settingsData(vault).dnd, Date.now()) || sleepState().here || sentryUp() || !!document.fullscreenElement) { onGone("busy"); return; }
    if (!PS) { setPhase("card"); return; }
    const g = window as Window & { __psIntroIsland?: (m: unknown) => void };
    let timer = window.setTimeout(() => onGone("noanswer"), ISLAND_ASK_MS);
    g.__psIntroIsland = (m) => {
      const r = introReply(m);
      if (!r) return;
      window.clearTimeout(timer);
      if (r.phase === "queued") timer = window.setTimeout(() => onGone("queued"), ISLAND_QUEUED_MS);
      else if (r.phase === "blocked") onGone(r.why);
      else { setAnchor(viaIsland ? r.anchor : null); setPhase("card"); }
    };
    psPost({ type: "island:intro", start: true, id: def.id });
    return () => { window.clearTimeout(timer); };
  }, [turn]); // eslint-disable-line react-hooks/exhaustive-deps
  // Leaving always frees the Mac's island (its queue moves on).
  useEffect(() => () => { const g = window as Window & { __psIntroIsland?: unknown }; delete g.__psIntroIsland; if (PS) psPost({ type: "island:intro", start: false, id: def.id }); }, [def.id]);

  const shownOnce = useRef(false);
  useEffect(() => {
    if (phase !== "card" || shownOnce.current) return;
    shownOnce.current = true;
    onShown(def.id);
    if (!PS) sfx.island("done");   // on the Mac the island plays the chime itself (its Island sounds switch)
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = (a: "show" | "later") => {
    if (phaseRef.current === "out") return;
    onAnswer(def.id, a);
    if (a === "show") { setGuide(true); setPhase("guide"); return; }
    setPhase("out");
    const quick = matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => onGone(), quick ? 0 : 340);
  };
  const closeGuide = useCallback(() => { setGuide(false); onGone(); }, [onGone]);

  // Esc (Mac, website) and Back (phone) close the card. The guide has its own (it is the one on top then).
  useLayoutEffect(() => {
    if (phase !== "card") return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); finish("later"); } };
    const back = (e: Event) => { e.preventDefault(); finish("later"); };
    const g = window as Window & { __psDimxClose?: () => boolean };
    const before = g.__psDimxClose;
    const esc = () => { finish("later"); return true; };
    window.addEventListener("keydown", key, true); window.addEventListener("gos-back", back);
    g.__psDimxClose = esc;
    return () => {
      window.removeEventListener("keydown", key, true); window.removeEventListener("gos-back", back);
      if (g.__psDimxClose === esc) { if (before) g.__psDimxClose = before; else delete g.__psDimxClose; }
    };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  // The Mac keeps the list up and gives it the keyboard while the card or guide is open (never over 1Password or Signal, PS checks).
  useLayoutEffect(() => {
    if (phase !== "card" && phase !== "guide") return;
    psPost({ type: "dimx", open: true });
    return () => { psPost({ type: "dimx", open: false }); };
  }, [phase === "card" || phase === "guide"]); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === "guide" && guide) {
    return createPortal(def.guide ? GUIDES[def.guide]({ onClose: closeGuide, anchor }) : <StepsGuide def={def} onClose={closeGuide} anchor={anchor} />, document.body);
  }
  if (phase !== "card" && phase !== "out") return null;
  const at = anchor ? attachedLayout(anchor, window.innerWidth, CARD_W) : null;
  const hung = at ? ({ "--fi-left": `${at.left}px`, "--fi-top": `${at.top}px`, "--fi-ox": `${at.originX}px`, "--fi-from": at.from } as CSSProperties) : undefined;
  return createPortal(
    <div className={`fi-layer${at ? " isl" : " plain"}${phase === "out" ? " out" : ""}`} style={hung} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <section className="fi-card" role="dialog" aria-modal="true" aria-labelledby="fi-title" style={{ "--fi-w": `${Math.min(CARD_W, window.innerWidth - 16)}px` } as CSSProperties}>
        <div className="fi-row">
          <span className="fi-mark" aria-hidden="true">{MARKS[def.mark](30)}</span>
          <b id="fi-title" className="fi-head">{def.headline}</b>
        </div>
        <p className="fi-ask">{def.ask}</p>
        <div className="fi-btns">
          <button type="button" className="fi-btn go" autoFocus onClick={() => { sfx.click(); finish("show"); }}>{def.show}</button>
          <button type="button" className="fi-btn" onClick={() => { sfx.click(); finish("later"); }}>{def.later}</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

/** The guide for an intro that has no guide of its own: its short steps, a demo link, and where it stays in Settings. */
function StepsGuide({ def, onClose, anchor }: { def: IntroDef; onClose: () => void; anchor: IslandAnchor | null }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    const back = (e: Event) => { e.preventDefault(); onClose(); };
    window.addEventListener("keydown", key, true); window.addEventListener("gos-back", back);
    return () => { window.removeEventListener("keydown", key, true); window.removeEventListener("gos-back", back); };
  }, [onClose]);
  const at = anchor ? attachedLayout(anchor, window.innerWidth, CARD_W) : null;
  const hung = at ? ({ "--fi-left": `${at.left}px`, "--fi-top": `${at.top}px`, "--fi-ox": `${at.originX}px`, "--fi-from": at.from } as CSSProperties) : undefined;
  return (
    <div className={`fi-layer${at ? " isl" : " plain"}`} style={hung} onMouseDown={(e) => e.stopPropagation()}>
      <section className="fi-card" role="dialog" aria-modal="true" aria-label={def.headline} style={{ "--fi-w": `${Math.min(CARD_W, window.innerWidth - 16)}px` } as CSSProperties}>
        <div className="fi-row"><span className="fi-mark" aria-hidden="true">{MARKS[def.mark](30)}</span><b className="fi-head">{def.headline}</b></div>
        <ol className="fi-steps">{(def.steps ?? []).map((t, i) => <li key={i}>{t}</li>)}</ol>
        <p className="fi-ask">You can open this again any time: {def.settings}.</p>
        <div className="fi-btns">
          {def.demo && <a className="fi-btn go" href={def.demo} target="_blank" rel="noreferrer noopener">See the demo</a>}
          <button type="button" className="fi-btn" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}
