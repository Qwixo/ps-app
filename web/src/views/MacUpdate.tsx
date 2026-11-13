// The update row at the top of the Tab list's gear menu on the Mac, the same flow as the phone's settings
// (src/gos/GosUpdate.tsx): "Update available · V1.23", a click opens the version and its notes, Update now
// runs Download, Verify, Install with one smooth bar, then "Relaunch to finish". Nothing goes in before the developer
// clicks Update now (V1.33, the developer: "click update now or something to actually update"). The shell does every
// check and the swap (ps-mac Sources/Updater.swift); this only shows its state and sends real clicks.
// The notes are the update's public ones (from the manifest, the same for everyone); on the developer's own account his
// private notes for that version follow as "For you" (core/privatenotes.ts), from his vault, never the manifest.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { macUpdate, useMacUpdate } from "../macupdate";
import type { MacUpdate } from "../core/macupdate";
import { tickHolds, type TickPhase } from "../core/updatetick";
import { tickStore, useTick } from "../updatetick";
import { sfx } from "../ui/sfx";
import "./macupdate.css";
import { appName } from "../core/appname";
import { useVault } from "../ui/kit";
import { PRIVATE_LABEL, privateNotesFor } from "../core/privatenotes";
import { catchUp } from "../core/notehistory";
import { byLine } from "../core/releaseby";
import { NoteGroups } from "../ui/NoteGroups";

const STEPS = ["Download", "Verify", "Install"] as const;
const mb = (n?: number) => (n ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)} MB` : "");
// V1.58: "V1.59 by Jan · Harmony" for a release that says who made it.
const named = (v?: string, k?: string, by?: string) => <>{v}{byLine(by) ? ` ${byLine(by)}` : null}{k ? <span className="mu-kw"> · {k}</span> : null}</>;

/** The bar eases towards what the shell reports (20 times a second at most) instead of jumping. */
function useEased(target: number) {
  const [shown, setShown] = useState(target);
  const raf = useRef(0);
  useEffect(() => {
    cancelAnimationFrame(raf.current);
    const step = () => setShown((v) => {
      const next = v + (target - v) * 0.12;
      if (Math.abs(target - next) < 0.002) return target;
      raf.current = requestAnimationFrame(step);
      return next;
    });
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target]);
  return shown;
}

/** When the row grows or shrinks (row, card, progress, Relaunch), what sits under it in the menu slides to
 *  its new place instead of jumping (transform only). */
function Glide({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // A ResizeObserver answers after layout and before the frame is painted, so nothing jumps first.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = el.offsetHeight;
    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight, d = last - h;
      last = h;
      if (!d || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      for (let n = el.nextElementSibling; n; n = n.nextElementSibling) {
        (n as HTMLElement).animate([{ transform: `translateY(${d}px)` }, { transform: "none" }], { duration: 300, easing: "cubic-bezier(.2, .9, .3, 1)" });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <div className="mu-wrap" ref={ref}>{children}</div>;
}

export function MacUpdateRow({ menuOpen }: { menuOpen: boolean }) {
  return <Glide><MacUpdateInner menuOpen={menuOpen} /></Glide>;
}

/** The tick on "Updated to V1.xx": a click looks for updates (core/updatetick.ts). */
const macTick = tickStore<MacUpdate>();

function MacUpdateInner({ menuOpen }: { menuOpen: boolean }) {
  const raw = useMacUpdate();
  const tk = useTick(macTick);
  useEffect(() => { macTick.seen(raw); }, [raw]);
  // While the tick looks, and after it found nothing (or could not look), the card stays as it was.
  const u = tk.home && tickHolds(raw.state, tk.phase, tk.check) ? tk.home : raw;
  const [open, setOpen] = useState(false);
  // A done or failed update is news once: opening the menu counts as seeing it.
  useEffect(() => { if (menuOpen && raw.unseen) macUpdate.seen(); }, [menuOpen, raw.unseen]);
  // The tick found an update: straight to its card with Update now (never installs by itself).
  const offered = useRef(0);
  useEffect(() => { if (tk.phase === "offer" && tk.check && offered.current !== tk.check.at) { offered.current = tk.check.at; setOpen(true); } }, [tk.phase, tk.check]);
  // Once the developer pressed Update the card stays open through every step.
  useEffect(() => { if (u.state !== "available" && u.state !== "idle" && u.state !== "none" && u.state !== "checking") setOpen(true); }, [u.state]);
  useEffect(() => { if (!menuOpen && (u.state === "available" || u.state === "none" || u.state === "idle")) setOpen(false); }, [menuOpen, u.state]);
  if (u.state === "available" && !open) {
    return (
      <button type="button" className="mu-row avail" onClick={() => { sfx.click(); setOpen(true); }} aria-expanded={false}>
        <span className="mu-dot" aria-hidden="true" />
        <span className="mu-row-t"><b>Update available</b><i aria-hidden="true">·</i><em>{named(u.version, u.keyword, u.by)}</em></span>
        <svg className="mu-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </button>
    );
  }
  if (u.state === "idle" || u.state === "none" || u.state === "checking") {
    return (
      <div className={`mu-row quiet s-${u.state}`}>
        <span className="mu-row-t">{u.state === "checking" ? "Looking for updates" : u.state === "none" ? `${appName()} is up to date` : "Updates"}</span>
        {/* V1.51 (the developer: people did not see the tick was the check button): always the reload symbol, spinning while it looks. */}
        <button type="button" className={`tm-ed-chip mu-check${u.state === "checking" ? " on" : ""}`} disabled={u.state === "checking"}
          aria-label={u.state === "checking" ? "Looking for updates" : "Check for updates"} title="Check for updates" onClick={() => { sfx.click(); macUpdate.check(); }}>
          <svg className="mu-i-ref" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <g><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4" /></g>
          </svg>
        </button>
      </div>
    );
  }
  const tick = u.state === "done" ? {
    phase: tk.phase, found: tk.phase === "tick" && tk.check?.result === "none",
    // Repeat clicks while it looks do nothing.
    go: () => { if (tk.phase !== "tick") return; sfx.click(); macTick.start({ ...u, unseen: false }); macUpdate.check(); },
  } : undefined;
  return <MacUpdateCard u={u} tick={tick} onLater={() => { sfx.drop(); setOpen(false); }} />;
}

type TickProps = { phase: TickPhase; found: boolean; go: () => void };

/** The done card's orb: the check for updates button. V1.51 (the developer, 12 Nov 2026: people did not realise the tick was the
 *  button that checks): always the reload symbol, which spins while it looks; the words beside it say up to date. */
function TickOrb({ t }: { t: TickProps }) {
  const busy = t.phase === "spin" || t.phase === "fail";
  return (
    <button type="button" className={`mu-orb tk t-${t.phase}${busy ? " busy" : ""}`} data-mu="tick" aria-disabled={busy}
      aria-label={busy ? "Looking for updates" : "Check for updates"} title={busy ? undefined : "Check for updates"}
      onClick={(e) => { if (e.button === 0) t.go(); }}>
      <svg className="mu-i-ref" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <g><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4" /></g>
      </svg>
    </button>
  );
}

export function MacUpdateCard({ u, tick, onLater }: { u: MacUpdate; tick?: TickProps; onLater: () => void }) {
  const target = u.state === "downloading" ? (u.progress ?? 0) : u.state === "verifying" || u.state === "installing" || u.state === "ready" || u.state === "relaunching" ? 1 : 0;
  const shown = useEased(target);
  const busy = u.state === "downloading" || u.state === "verifying" || u.state === "installing" || u.state === "relaunching";
  const stepAt = u.state === "downloading" ? 0 : u.state === "verifying" ? 1 : u.state === "installing" ? 2 : u.state === "ready" || u.state === "relaunching" ? 3 : -1;
  const app = u.kind !== "web";
  const s = useVault();
  const mine = u.state === "available" && s.status === "unlocked" ? privateNotesFor(s.docs.values(), u.version, s.red) : [];
  // V1.52: an update across several versions lists every version newer than this Mac's, newest first.
  const blocks = u.state === "available"
    ? catchUp([...(u.version && u.notes?.length ? [{ version: u.version, keyword: u.keyword ?? "", notes: u.notes, by: u.by }] : []), ...(u.history ?? [])], u.current, u.version)
    : [];
  const title = u.state === "available" ? <>Update available · {named(u.version, u.keyword, u.by)}</>
    : u.state === "downloading" ? <>Downloading {named(u.version, u.keyword)}</>
    : u.state === "verifying" ? "Checking it is really yours"
    : u.state === "installing" ? "Installing"
    : u.state === "ready" ? (app ? "Relaunch to finish" : "Ready to finish")
    : u.state === "relaunching" ? (app ? `Relaunching ${appName()}` : "Finishing")
    : u.state === "done" ? <>Updated to {named(u.current, u.currentKeyword)}</>
    : "Update stopped";
  const sub = u.state === "available" ? `${app ? "New app build" : "Web update, no restart"}${u.size ? ` · ${mb(u.size)}` : ""}`
    : u.state === "downloading" ? `${Math.round(shown * 100)}%${u.size ? ` of ${mb(u.size)}` : ""}`
    : u.state === "verifying" ? "Your signature, every file's SHA-256 and your certificate"
    : u.state === "installing" ? (app ? "Putting the new build beside this one" : "Unpacking the new pages")
    : u.state === "ready" ? (app ? `${appName()} closes for a moment and comes back updated. You stay signed in.` : "The pages reload. No restart.")
    : u.state === "relaunching" ? "Back in a moment"
    : u.state === "done" ? (tick?.phase === "spin" ? "Looking for updates" : tick?.phase === "fail" ? "Could not check"
      : tick?.found ? `${appName()} is up to date` : app ? "You are still signed in." : "No restart needed.")
    : `${u.error || "Something went wrong"}. Nothing was changed.`;
  const ok = u.state === "ready" || u.state === "done";
  return (
    <section className={`mu-card s-${u.state}`} aria-live="polite">
      <div className="mu-top">
        {tick ? <TickOrb t={tick} /> : <span className={`mu-orb${busy ? " spin" : ""}`} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            {ok ? <path d="M5 12.5l4.2 4.2L19 7" className="mu-draw" key="ok" /> : u.state === "error" ? <path d="M12 7v6M12 17h.01" /> : u.state === "relaunching" ? <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4" /> : <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />}
          </svg>
        </span>}
        <div className="mu-txt">
          <div className="mu-t" key={u.state}>{title}</div>
          {tick ? <div className={`mu-s num fx${tick.phase === "fail" ? " soft" : ""}`} key={sub}>{sub}</div> : <div className="mu-s num">{sub}</div>}
        </div>
      </div>
      {blocks.length > 1 && <NoteGroups blocks={blocks} />}
      {blocks.length <= 1 && u.state === "available" && !!u.notes?.length && (
        <ul className="mu-notes">{u.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
      )}
      {!!mine.length && (
        <div className="mu-mine">
          <span className="mu-mine-h">{PRIVATE_LABEL}<em>Only you see these</em></span>
          <ul className="mu-notes">{mine.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
      )}
      {stepAt >= 0 && (
        <div className="mu-prog">
          <div className="mu-bar"><i style={{ transform: `scaleX(${shown})` }} /></div>
          <ol className="mu-steps">
            {STEPS.map((s, i) => <li key={s} className={i < stepAt ? "done" : i === stepAt ? "on" : ""}><span />{s}</li>)}
          </ol>
        </div>
      )}
      {(u.state === "available" || u.state === "ready" || u.state === "error") && (
        <div className="mu-btns">
          {u.state === "available" && <button type="button" className="mu-btn ghost" onClick={onLater}>Later</button>}
          {u.state === "error" && <button type="button" className="mu-btn ghost" onClick={() => { sfx.click(); macUpdate.check(); }}>Try again</button>}
          {u.state === "available" && <button type="button" className="mu-btn primary" data-mu="start" onClick={() => { sfx.click(); macTick.reset(); macUpdate.start(); }}>Update now</button>}
          {u.state === "ready" && <button type="button" className="mu-btn primary go" data-mu="finish" onClick={() => { sfx.click(); macUpdate.finish(); }}>{app ? "Relaunch to finish" : "Finish"}</button>}
        </div>
      )}
    </section>
  );
}

/** The dot on the gear: pink while an update waits, green once one went in, red when one stopped. */
export function MacUpdateDot({ kind }: { kind: "update" | "done" | "error" | null }) {
  return kind ? <span className={`mu-gear-dot ${kind}`} aria-label={kind === "update" ? "Update available" : kind === "done" ? `${appName()} was updated` : "An update stopped"} /> : null;
}
